// Exercise the actual patched download branch using a fake HTTP transport.
// No credentials, live requests or music commands are involved.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const cpp = fs.readFileSync(path.join(__dirname,
  '../esphome/components/online_image/online_image.cpp'), 'utf8');
const start = cpp.indexOf('  if (this->get_format() == runtime_image::JPEG && this->downloader_->content_length == 0)');
const end = cpp.indexOf('  size_t available =', start);
if (start < 0 || end < 0) throw new Error('Chunked JPEG branch not found');
const source = `
#include <algorithm>
#include <cassert>
#include <cstdint>
#include <cstring>
#include <memory>
#include <string>
#include <vector>
#define ESP_LOGE(...)
#define ESP_LOGD(...)
const char *ETAG_HEADER_NAME="", *LAST_MODIFIED_HEADER_NAME="";
namespace runtime_image { constexpr int JPEG=1; }
uint32_t clock_ms=0;
uint32_t millis(){ return clock_ms; }
struct Buffer {
 std::vector<uint8_t> bytes; size_t used=0;
 Buffer(size_t n):bytes(n){}
 size_t free_capacity(){return bytes.size()-used;}
 uint8_t *append(){return bytes.data()+used;}
 uint8_t *data(){return bytes.data();}
 size_t unread(){return used;}
 void write(size_t n){used+=n;}
 void read(size_t n){used-=n;}
};
struct Http {
 size_t content_length=0, pos=0;
 bool fail=false;
 std::vector<uint8_t> bytes;
 int read(uint8_t *out,size_t n){
   if(fail)return -1;
   n=std::min(n,bytes.size()-pos);
   memcpy(out,bytes.data()+pos,n);pos+=n;return n;
 }
 std::string get_response_header(const char*){return "";}
};
struct Callback {
 int count=0;
 void call(){++count;}
 void call(bool){++count;}
};
struct Image {
 std::shared_ptr<Http> downloader_=std::make_shared<Http>();
 Buffer download_buffer_;
 size_t download_buffer_initial_size_=137;
 uint32_t start_time_=0;
 std::string etag_,last_modified_;
 Callback download_error_callback_,download_finished_callback_;
 bool closed=false, finalized=false, decode_fail=false;
 int decode_calls=0;
 Image(size_t cap=20000):download_buffer_(cap){}
 int get_format(){return runtime_image::JPEG;}
 void end_connection_(){closed=true;}
 void end_decode(){finalized=true;}
 int feed_data(uint8_t *,size_t n){
   ++decode_calls;
   assert(downloader_->pos==downloader_->bytes.size());
   return decode_fail ? -1 : static_cast<int>(n);
 }
 void loop(){${cpp.slice(start,end)}}
};
void run(Image &i){clock_ms=0;while(!i.closed && clock_ms<20000){i.loop();clock_ms+=10;}}
void populate(Image &i){
 i.downloader_->bytes.assign(9000,0x42);
 auto &b=i.downloader_->bytes;b[0]=0xff;b[1]=0xd8;b[b.size()-2]=0xff;b.back()=0xd9;
}
int main(){
 Image good;populate(good);run(good);
 assert(good.decode_calls==1 && good.finalized && good.download_finished_callback_.count==1);
 Image truncated;populate(truncated);truncated.downloader_->bytes.pop_back();run(truncated);
 assert(truncated.decode_calls==0 && truncated.download_error_callback_.count==1);
 Image oversized(1000);populate(oversized);run(oversized);
 assert(oversized.decode_calls==0 && oversized.download_error_callback_.count==1);
 Image transport;populate(transport);transport.downloader_->fail=true;run(transport);
 assert(transport.decode_calls==0 && transport.download_error_callback_.count==1);
 Image corrupt;populate(corrupt);corrupt.decode_fail=true;run(corrupt);
 assert(!corrupt.finalized && corrupt.download_error_callback_.count==1);
}
`;
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'energydeck-cover-'));
try {
 fs.writeFileSync(path.join(dir,'test.cpp'),source);
 execFileSync('c++',['-std=c++17',path.join(dir,'test.cpp'),'-o',path.join(dir,'test')]);
 execFileSync(path.join(dir,'test'));
 console.log('PASS: chunked JPEG completion, no partial decode, truncation timeout, size limit, read/decode failures');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
