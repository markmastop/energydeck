#include "../esphome/components/ui_performance/battery_detail.h"
#include <cassert>
#include <iostream>
int main() {
  energydeck::BatteryPlan p;
  const uint32_t epoch = 1792969140;
  assert(p.begin_forward(epoch, epoch + 600, 5, 1000, 10, 20, true, true, false, 0));
  assert(p.add_forward(epoch, epoch + 60, 1, -1000, -10, 50, 50.3, 0, 1));
  assert(p.add_forward(epoch + 60, epoch + 960, 2, 500, 50, 50.3, 47.7, .5, 0));
  const energydeck::BatteryDetailGeometry g(p);
  assert(g.x(epoch, 404) == 0 && g.x(epoch + 960, 404) == 404);
  assert(g.x(epoch + 60, 404) == 25); // Partial quarter uses elapsed time, not index spacing.
  assert(g.price_y(-10, 144) == 143 && g.price_y(50, 144) == 0);
  assert(g.power_y(-1000, 144) > g.power_y(0, 144));
  assert(g.power_y(500, 144) < g.power_y(0, 144));
  assert(g.soc_y(100, 144) == 0 && g.soc_y(0, 144) == 143);
  assert(g.soc_y(50, 144) == 72 && g.soc_y(47.7, 144) > g.soc_y(50.3, 144));
  assert(g.soc_y(101, 144) == 0 && g.soc_y(-1, 144) == 143);
  assert(g.selected(epoch + 70, epoch) == 1 && g.selected(0, epoch) == 0);
  assert(g.selected(epoch - 1, epoch) == 0);
  const energydeck::BatteryStrategyWindow window{epoch + 30, epoch + 510};
  int64_t a, b;
  assert(window.clip(p.intervals[0], a, b) && a == epoch + 30 && b == epoch + 60);
  assert(window.x(a, 384) == 0 && window.x(b, 384) == 24);
  assert(std::abs(window.soc(p.intervals[0], a) - 50.15f) < .001f);
  assert(window.clip(p.intervals[1], a, b) && b == epoch + 510);
  assert(window.x(b, 384) == 384);
  assert((!energydeck::BatteryStrategyWindow{epoch + 960, epoch + 2000}.clip(p.intervals[1], a, b)));
  energydeck::LineHistory history;history.day_start=epoch-3600;history.day_end=epoch+3600;
  history.add(epoch-1800,60,false);history.add(epoch-1500,58,false);history.add(epoch-300,52,false);
  history.loaded=true;history.date=20261025;history.fetched_at=1;
  assert(history.available(20261025,epoch+1800));
  assert(!history.fresh(20261025,1000000,epoch+1800));
  assert(!history.available(20261026,epoch+1800));
  int measured=0,forecast=0;
  energydeck::battery_soc_segments(&history,&p,epoch,51,[&](int64_t a,float av,int64_t b,float bv,bool predicted){
    if(predicted){if(!forecast){assert(a==epoch && av==51);}forecast++;}
    else {assert(b-a<=900 && b<=epoch);measured++;}
  });
  assert(measured==2 && forecast==2);
  const energydeck::BatteryDetailGeometry historical(p,epoch-3600);
  assert(historical.x(epoch-3600,404)==0 && historical.x(epoch,404)>0);
  energydeck::PriceDay prices; prices.start=epoch-3600; prices.end=epoch+3600; prices.count=8;
  prices.values.fill(80);
  const energydeck::BatteryDetailGeometry full(p,0,&prices);
  assert(full.from==epoch-3600 && full.high==80);
  assert(full.selection(0,epoch)==epoch && full.selection(epoch-900,epoch)==epoch-900);
  assert(full.selection(epoch+2000,epoch)==epoch+959);
  assert(full.price_at(epoch-900,&prices)==80);
  assert(std::abs(full.measured_soc(&history,epoch-1650)-59)<.001);
  assert(!std::isfinite(full.measured_soc(&history,epoch-900))); // Missing interval is not bridged.
  std::cout << "PASS: aligned UTC axes, partial quarters, negative prices, signed power and time selection\n";
}
