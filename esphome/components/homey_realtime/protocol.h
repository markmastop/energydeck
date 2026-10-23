#pragma once
#include <ArduinoJson.h>
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace esphome::homey_realtime {
// Homey's official client uses Engine.IO 3 / Socket.IO 2: first authenticate on
// the root socket, then join the returned namespace and acknowledge each URI.
// We only consume notifications; writes/Flows are never sent on this socket.
class Protocol {
 public:
  static constexpr size_t MAX_PACKET = 32768;
  using Send = std::function<bool(const std::string &)>;
  using Change = std::function<void(size_t)>;
  Protocol(std::string token, std::string homey_id, std::vector<std::string> uris, Send send, Change changed, uint32_t now)
      : token_(std::move(token)), homey_id_(std::move(homey_id)), uris_(std::move(uris)),
        send_(std::move(send)), changed_(std::move(changed)), started_(now), ping_at_(now) {}
  bool ready() const { return ready_; }
  bool tick(uint32_t now) {
    if (failed_ || (!ready_ && uint32_t(now - started_) > 10000)) return false;
    if (!engine_open_) return true;
    if (awaiting_pong_ && uint32_t(now - ping_at_) > ping_timeout_) return false;
    if (!awaiting_pong_ && uint32_t(now - ping_at_) >= ping_interval_) {
      awaiting_pong_ = true; ping_at_ = now;
      return transmit_("2");
    }
    return true;
  }
  bool receive(const std::string &packet, uint32_t now) {
    if (packet.empty() || packet.size() > MAX_PACKET || failed_) return false;
    if (packet == "3") { awaiting_pong_ = false; ping_at_ = now; return true; }
    if (packet == "1" || packet == "41" || packet == "41" + namespace_ + ",") return false;
    if (packet[0] == '0') {
      JsonDocument doc;
      if (deserializeJson(doc, packet.data() + 1, packet.size() - 1, DeserializationOption::NestingLimit(16))) return false;
      const auto interval = doc["pingInterval"].as<uint32_t>(), timeout = doc["pingTimeout"].as<uint32_t>();
      if (interval < 1000 || interval > 60000 || timeout < 1000 || timeout > 120000) return false;
      ping_interval_ = interval; ping_timeout_ = timeout; ping_at_ = now; engine_open_ = true;
      return true;
    }
    if (packet == "40" && engine_open_ && !handshake_sent_) {
      JsonDocument doc;
      auto args = doc.to<JsonArray>(); args.add("handshakeClient");
      auto auth = args.add<JsonObject>(); auth["token"] = token_; auth["homeyId"] = homey_id_;
      std::string payload; serializeJson(doc, payload); handshake_sent_ = true;
      return transmit_("420" + payload);
    }
    if (packet.rfind("430[", 0) == 0 && handshake_sent_ && namespace_.empty()) {
      JsonDocument doc;
      if (deserializeJson(doc, packet.data() + 3, packet.size() - 3, DeserializationOption::NestingLimit(16)) || !doc.is<JsonArray>() || !doc[0].isNull()) return false;
      const std::string ns = doc[1]["namespace"] | "";
      if (ns.size() < 2 || ns.size() > 96 || ns[0] != '/' || ns.find_first_not_of("/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-") != std::string::npos) return false;
      namespace_ = ns;
      return transmit_("40" + namespace_ + ",");
    }
    if (!namespace_.empty() && packet == "40" + namespace_ + ",") return subscribe_next_();
    const std::string ack = "43" + namespace_ + "," + std::to_string(subscribed_ + 1);
    if (!namespace_.empty() && subscribed_ < uris_.size() && packet.rfind(ack + "[", 0) == 0) {
      JsonDocument doc;
      // Homey firmware versions acknowledge with either []
      // or [null]. Both mean no error, just like the official client's callback.
      if (deserializeJson(doc, packet.data() + ack.size(), packet.size() - ack.size(), DeserializationOption::NestingLimit(16)) ||
          !doc.is<JsonArray>() || !doc[0].isNull()) return false;
      subscribed_++;
      return subscribe_next_();
    }
    const std::string prefix = "42" + namespace_ + ",";
    if (!namespace_.empty() && packet.rfind(prefix + "[", 0) == 0) {
      JsonDocument doc;
      if (deserializeJson(doc, packet.data() + prefix.size(), packet.size() - prefix.size(), DeserializationOption::NestingLimit(16)) || !doc.is<JsonArray>()) return false;
      const std::string uri = doc[0] | "", event = doc[1] | "";
      for (size_t i = 0; i < uris_.size(); i++) {
        if (uri != uris_[i]) continue;
        if (uri == "homey:manager:logic") {
          const std::string id = doc[2]["id"] | "";
          if ((event == "variable.update" || event == "variable.delete") && id == price_id_) changed_(i);
        } else if (event == "capability" || event == "update" || event == "delete") changed_(i);
      }
    }
    // Authentication/namespace errors must reconnect rather than look healthy.
    if (packet.rfind("44", 0) == 0) return false;
    return true;
  }
  void set_price_id(std::string id) { price_id_ = std::move(id); }
 protected:
  bool transmit_(const std::string &packet) { if (!send_(packet)) failed_ = true; return !failed_; }
  bool subscribe_next_() {
    if (subscribed_ == uris_.size()) {
      if (!ready_) { ready_ = true; for (size_t i = 0; i < uris_.size(); i++) changed_(i); }
      return true;
    }
    JsonDocument doc;
    auto args = doc.to<JsonArray>(); args.add("subscribe"); args.add(uris_[subscribed_]);
    std::string payload; serializeJson(doc, payload);
    return transmit_("42" + namespace_ + "," + std::to_string(subscribed_ + 1) + payload);
  }
  std::string token_, homey_id_, namespace_, price_id_;
  std::vector<std::string> uris_;
  Send send_;
  Change changed_;
  size_t subscribed_{0};
  uint32_t started_, ping_at_, ping_interval_{25000}, ping_timeout_{20000};
  bool engine_open_{false}, handshake_sent_{false}, awaiting_pong_{false}, ready_{false}, failed_{false};
};
}  // namespace esphome::homey_realtime
