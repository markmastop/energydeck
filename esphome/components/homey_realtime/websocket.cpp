#include "websocket.h"
#include "protocol.h"
#include "esphome/core/hal.h"
#include "esphome/core/helpers.h"
#include <algorithm>
#include <cctype>
#include <cstdlib>
#ifdef USE_ESP32
#include "esp_transport_tcp.h"
#include "esp_transport_ssl.h"
#include "esp_transport_ws.h"
#include "esp_crt_bundle.h"
#else
#include <cerrno>
#include <cstring>
#include <fcntl.h>
#include <netdb.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <unistd.h>
#include <openssl/evp.h>
#include <openssl/ssl.h>
#endif

namespace esphome::homey_realtime {
namespace {
struct Endpoint {
  std::string host, authority;
  int port{80};
  bool tls{false};
  bool parse(std::string address) {
    if (!address.empty() && address.back() == '/') address.pop_back();
    tls = address.rfind("https://", 0) == 0;
    const size_t offset = tls ? 8 : 7;
    if (!tls && address.rfind("http://", 0) != 0) return false;
    authority = address.substr(offset);
    if (authority.empty() || authority.size() > 255 || authority.find_first_not_of("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-:[]") != std::string::npos) return false;
    size_t separator = std::string::npos;
    if (authority[0] == '[') {
      const auto end = authority.find(']');
      if (end == std::string::npos) return false;
      host = authority.substr(1, end - 1);
      if (end + 1 < authority.size()) { if (authority[end + 1] != ':') return false; separator = end + 1; }
    } else {
      separator = authority.find(':'); host = authority.substr(0, separator);
    }
    port = tls ? 443 : 80;
    if (separator != std::string::npos) {
      const auto text = authority.substr(separator + 1);
      if (text.empty() || text.size() > 5 || text.find_first_not_of("0123456789") != std::string::npos) return false;
      port = std::atoi(text.c_str());
    }
    return !host.empty() && port > 0 && port <= 65535;
  }
};
constexpr const char *PATH = "/socket.io/?EIO=3&transport=websocket";
}

#ifdef USE_ESP32
struct WebSocket::Impl {
  esp_transport_handle_t parent{nullptr}, ws{nullptr};
  std::string message;
  int remaining{0}, opcode{0};
  bool fin{true}, fragmented{false};
  ~Impl() {
    if (ws) { esp_transport_close(ws); esp_transport_destroy(ws); }
    if (parent) esp_transport_destroy(parent);
  }
  bool connect(const Endpoint &endpoint) {
    parent = endpoint.tls ? esp_transport_ssl_init() : esp_transport_tcp_init();
    if (!parent) return false;
    if (endpoint.tls) esp_transport_ssl_crt_bundle_attach(parent, esp_crt_bundle_attach);
    ws = esp_transport_ws_init(parent);
    if (!ws) return false;
    esp_transport_ws_config_t config{}; config.ws_path = PATH; config.user_agent = "EnergyDeck"; config.propagate_control_frames = true;
    if (esp_transport_ws_set_config(ws, &config) != ESP_OK) return false;
    return esp_transport_connect(ws, endpoint.host.c_str(), endpoint.port, 6000) >= 0 && esp_transport_ws_get_upgrade_request_status(ws) == 101;
  }
  bool frame(int code, const std::string &data) {
    return esp_transport_ws_send_raw(ws, static_cast<ws_transport_opcodes_t>(code | 0x80), data.data(), data.size(), 2000) == static_cast<int>(data.size());
  }
  int receive(std::string &packet) {
    char buffer[1024];
    const int count = esp_transport_read(ws, buffer, sizeof(buffer), 200);
    if (count < 0) return -1;
    if (!remaining) {
      opcode = esp_transport_ws_get_read_opcode(ws);
      if (opcode == WS_TRANSPORT_OPCODES_NONE) return 0;
      remaining = esp_transport_ws_get_read_payload_len(ws);
      fin = esp_transport_ws_get_fin_flag(ws);
      if (remaining < 0 || static_cast<size_t>(remaining) > Protocol::MAX_PACKET || opcode == 8) return -1;
      if (opcode == 1) { if (fragmented) return -1; message.clear(); }
      else if (opcode == 0) { if (!fragmented) return -1; }
      else if (opcode != 9 && opcode != 10) return -1;
      if (opcode >= 8 && (!fin || remaining > 125)) return -1;
    }
    remaining -= count;
    if (remaining < 0) return -1;
    if (opcode == 9) return remaining == 0 && frame(10, std::string(buffer, count)) ? 0 : -1;
    if (opcode == 10) return 0;
    if (message.size() + count > Protocol::MAX_PACKET) return -1;
    message.append(buffer, count);
    if (remaining) return 0;
    fragmented = !fin;
    if (!fin) return 0;
    packet = std::move(message); message.clear(); return 1;
  }
};
#else
namespace {
std::string base64(const unsigned char *bytes, size_t size) {
  std::string result(4 * ((size + 2) / 3), '\0');
  EVP_EncodeBlock(reinterpret_cast<unsigned char *>(result.data()), bytes, size); return result;
}
bool readable(int fd, int milliseconds, bool writing = false) {
  fd_set set; FD_ZERO(&set); FD_SET(fd, &set);
  timeval wait{milliseconds / 1000, (milliseconds % 1000) * 1000};
  return select(fd + 1, writing ? nullptr : &set, writing ? &set : nullptr, nullptr, &wait) > 0;
}
}
struct WebSocket::Impl {
  int fd{-1}; SSL_CTX *context{nullptr}; SSL *ssl{nullptr};
  std::string incoming, message;
  bool fragmented{false};
  ~Impl() { if (ssl) SSL_free(ssl); if (context) SSL_CTX_free(context); if (fd >= 0) ::close(fd); }
  bool write(const char *data, size_t size) {
    const auto start = millis();
    while (size) {
      if (uint32_t(millis() - start) > 6000 || !readable(fd, 2000, true)) return false;
      const int sent = ssl ? SSL_write(ssl, data, size) : ::send(fd, data, size, 0);
      if (sent <= 0) return false;
      data += sent; size -= sent;
    }
    return true;
  }
  int read(char *data, size_t size) {
    if (!(ssl && SSL_pending(ssl)) && !readable(fd, 200)) return 0;
    const int count = ssl ? SSL_read(ssl, data, size) : ::recv(fd, data, size, 0);
    return count > 0 ? count : -1;
  }
  bool connect(const Endpoint &endpoint) {
    addrinfo hints{}, *addresses = nullptr; hints.ai_socktype = SOCK_STREAM; hints.ai_family = AF_UNSPEC;
    if (getaddrinfo(endpoint.host.c_str(), std::to_string(endpoint.port).c_str(), &hints, &addresses)) return false;
    for (auto *address = addresses; address; address = address->ai_next) {
      fd = ::socket(address->ai_family, address->ai_socktype, address->ai_protocol);
      if (fd < 0) continue;
#ifdef SO_NOSIGPIPE
      int yes = 1; setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &yes, sizeof(yes));
#endif
      fcntl(fd, F_SETFL, O_NONBLOCK);
      int error = 0; socklen_t size = sizeof(error);
      const int result = ::connect(fd, address->ai_addr, address->ai_addrlen);
      const bool connected = result == 0 || (errno == EINPROGRESS && readable(fd, 6000, true) && getsockopt(fd, SOL_SOCKET, SO_ERROR, &error, &size) == 0 && error == 0);
      if (connected) break;
      ::close(fd); fd = -1;
    }
    freeaddrinfo(addresses); if (fd < 0) return false;
    fcntl(fd, F_SETFL, 0);
    timeval timeout{6, 0}; setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout)); setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
    if (endpoint.tls) {
      context = SSL_CTX_new(TLS_client_method()); if (!context) return false;
      SSL_CTX_set_verify(context, SSL_VERIFY_PEER, nullptr);
      if (SSL_CTX_set_default_verify_paths(context) != 1) return false;
      ssl = SSL_new(context); if (!ssl) return false;
      SSL_set_fd(ssl, fd); SSL_set_tlsext_host_name(ssl, endpoint.host.c_str());
      if (SSL_set1_host(ssl, endpoint.host.c_str()) != 1 || SSL_connect(ssl) != 1) return false;
    }
    unsigned char random[16]; if (!random_bytes(random, sizeof(random))) return false;
    const auto key = base64(random, sizeof(random));
    const std::string request = std::string("GET ") + PATH + " HTTP/1.1\r\nHost: " + endpoint.authority +
      "\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: " + key + "\r\n\r\n";
    if (!write(request.data(), request.size())) return false;
    const auto start = millis(); char buffer[1024];
    while (incoming.find("\r\n\r\n") == std::string::npos) {
      if (uint32_t(millis() - start) > 6000 || incoming.size() > 4096) return false;
      const int count = read(buffer, sizeof(buffer)); if (count < 0) return false; incoming.append(buffer, count);
    }
    const auto boundary = incoming.find("\r\n\r\n");
    const auto header = incoming.substr(0, boundary); incoming.erase(0, boundary + 4);
    if (header.rfind("HTTP/1.1 101 ", 0) != 0) return false;
    const auto input = key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    unsigned char hash[EVP_MAX_MD_SIZE]; unsigned int hash_size = 0;
    if (EVP_Digest(input.data(), input.size(), hash, &hash_size, EVP_sha1(), nullptr) != 1) return false;
    const auto expected = base64(hash, hash_size);
    std::string lower = header; std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char c) { return std::tolower(c); });
    const auto field = lower.find("\r\nsec-websocket-accept:");
    if (field == std::string::npos) return false;
    auto begin = header.find(':', field + 2) + 1; while (begin < header.size() && header[begin] == ' ') begin++;
    auto end = header.find("\r\n", begin); if (end == std::string::npos) end = header.size();
    return header.substr(begin, end - begin) == expected;
  }
  bool frame(int opcode, const std::string &data) {
    if (data.size() > Protocol::MAX_PACKET) return false;
    std::string bytes; bytes.push_back(static_cast<char>(0x80 | opcode));
    if (data.size() < 126) bytes.push_back(static_cast<char>(0x80 | data.size()));
    else { bytes.push_back(static_cast<char>(0x80 | 126)); bytes.push_back(static_cast<char>(data.size() >> 8)); bytes.push_back(static_cast<char>(data.size())); }
    uint8_t mask[4]; if (!random_bytes(mask, sizeof(mask))) return false;
    bytes.append(reinterpret_cast<char *>(mask), sizeof(mask));
    for (size_t i = 0; i < data.size(); i++) bytes.push_back(data[i] ^ mask[i % 4]);
    return write(bytes.data(), bytes.size());
  }
  int receive(std::string &packet) {
    char buffer[4096];
    if (incoming.size() < 2) { const int count = read(buffer, sizeof(buffer)); if (count <= 0) return count; incoming.append(buffer, count); }
    if (incoming.size() < 2) return 0;
    const auto first = static_cast<uint8_t>(incoming[0]), second = static_cast<uint8_t>(incoming[1]);
    const int opcode = first & 15; const bool fin = (first & 0x80) != 0;
    if ((first & 0x70) || (second & 0x80)) return -1; // No negotiated extensions; server frames are unmasked.
    size_t length = second & 0x7f, header = 2;
    if (length == 127) return -1;
    if (length == 126) {
      if (incoming.size() < 4) { const int count = read(buffer, sizeof(buffer)); if (count < 0) return -1; incoming.append(buffer, count); if (incoming.size() < 4) return 0; }
      length = (static_cast<uint8_t>(incoming[2]) << 8) | static_cast<uint8_t>(incoming[3]); header = 4;
    }
    if (length > Protocol::MAX_PACKET || (opcode >= 8 && (!fin || length > 125))) return -1;
    if (incoming.size() < header + length) {
      const int count = read(buffer, sizeof(buffer)); if (count < 0) return -1; incoming.append(buffer, count);
      if (incoming.size() < header + length) return 0;
    }
    const auto payload = incoming.substr(header, length); incoming.erase(0, header + length);
    if (opcode == 8) return -1;
    if (opcode == 9) return frame(10, payload) ? 0 : -1;
    if (opcode == 10) return 0;
    if (opcode == 1) { if (fragmented) return -1; message.clear(); }
    else if (opcode != 0 || !fragmented) return -1;
    if (message.size() + payload.size() > Protocol::MAX_PACKET) return -1;
    message += payload; fragmented = !fin;
    if (!fin) return 0;
    packet = std::move(message); message.clear(); return 1;
  }
};
#endif

WebSocket::WebSocket() : impl_(new Impl) {}
WebSocket::~WebSocket() = default;
bool WebSocket::connect(const std::string &address) { Endpoint endpoint; return endpoint.parse(address) && impl_->connect(endpoint); }
bool WebSocket::send(const std::string &packet) { return impl_->frame(1, packet); }
int WebSocket::receive(std::string &packet) { return impl_->receive(packet); }
}  // namespace esphome::homey_realtime
