#pragma once
#include "price_day.h"
#include <ctime>

namespace energydeck {
// Read-only counterpart of ev-plan.js. Local civil periods preserve DST;
// each selected window always contains twenty-four consecutive real quarters.
struct EvChargingPlan {
  static constexpr size_t QUARTERS = 24;
  struct Slot { int64_t from; float price; int64_t key; };
  struct Window { int64_t from, until, key; float cost; };
  std::array<Slot,200> slots{};
  std::array<Window,6> windows{};
  size_t count{0}, window_count{0};
  void clear() { count=window_count=0; }
  static int64_t period(int64_t epoch) {
    const time_t stamp=epoch; tm local{}; localtime_r(&stamp,&local);
    const bool day=local.tm_hour>=8 && local.tm_hour<20;
    if(local.tm_hour<8) --local.tm_mday;
    local.tm_hour=day?8:20; local.tm_min=local.tm_sec=0;
    local.tm_isdst=-1; return mktime(&local);
  }
  void build(const PriceDay &today,const PriceDay *tomorrow) {
    clear();
    for(const auto *day:{&today,tomorrow}) {
      if(!day || !day->count) continue;
      for(int i=0;i<day->count && count<slots.size();++i) {
        const auto from=day->start+i*900;
        slots[count++]={from,day->values[i],period(from)};
      }
    }
    for(size_t i=0;i+QUARTERS<=count;++i) {
      bool valid=true; float cost=0;
      for(size_t j=0;j<QUARTERS;++j) {
        const auto &q=slots[i+j];
        if(q.key!=slots[i].key || q.from!=slots[i].from+int64_t(j)*900 || !std::isfinite(q.price))valid=false;
        cost+=q.price;
      }
      if(!valid)continue;
      size_t at=0;while(at<window_count && windows[at].key!=slots[i].key)++at;
      if(at==window_count) { if(window_count==windows.size())continue; ++window_count; windows[at].cost=INFINITY; }
      if(cost<windows[at].cost)windows[at]={slots[i].from,slots[i+QUARTERS-1].from+900,slots[i].key,cost};
    }
  }
  bool allowed(int64_t from,int64_t until) const {
    for(size_t i=0;i<window_count;++i)if(windows[i].from<=from && windows[i].until>=until)return true;
    return false;
  }
  const Window *next(int64_t now) const {
    const Window *result=nullptr;
    for(size_t i=0;i<window_count;++i)if(windows[i].until>now && (!result || windows[i].from<result->from))result=&windows[i];
    return result;
  }
};
}
