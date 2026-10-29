#include "../esphome/components/ui_performance/ev_plan.h"
#include <iostream>
#include <cstdlib>
#include <cassert>
int main(int argc,char **argv) {
  if(argc!=3) return 1;
  setenv("TZ","Europe/Amsterdam",1);tzset();
  energydeck::PriceDay a,b;
  a.start=std::atoll(argv[1]);a.count=std::atoi(argv[2]);a.end=a.start+a.count*900;
  b.start=a.end;b.count=96;b.end=b.start+86400;
  for(int i=0;i<a.count;++i)a.values[i]=(i*13)%31-5;
  for(int i=0;i<b.count;++i)b.values[i]=(i*7)%23-3;
  energydeck::EvChargingPlan p;p.build(a,&b);
  // Exercise the actual display states, including manual charging outside advice.
  energydeck::EvChargingActivity activity;
  auto visual=p; visual.window_count=1; visual.windows[0]={a.start,a.start+6*3600,0,0};
  const auto first=visual.windows[0].from;
  assert(activity.state(visual,first,first,true)==energydeck::EvChargingActivity::PLANNED);
  assert(activity.state(visual,first,first,false)==energydeck::EvChargingActivity::ALLOW);
  assert(activity.state(visual,first,first+900,false)==energydeck::EvChargingActivity::ALLOW);
  const auto outside=a.start+24*900;
  assert(!visual.allowed(outside,outside+900));
  assert(activity.state(visual,outside,outside,true)==energydeck::EvChargingActivity::WAIT);
  assert(activity.state(visual,first,outside,true)==energydeck::EvChargingActivity::ALLOW);
  // Completed/unavailable sessions retain blue advice, and later windows do too.
  visual.window_count=2; visual.windows[1]={a.start+12*3600,a.start+18*3600,0,0};
  assert(activity.state(visual,visual.windows[1].from,first,true)==energydeck::EvChargingActivity::ALLOW);
  assert(activity.state(visual,visual.windows[1].from,first,false)==energydeck::EvChargingActivity::ALLOW);
  assert(activity.state(visual,visual.windows[1].from,outside,true)==energydeck::EvChargingActivity::PLANNED);
  activity.observe(outside,false);
  assert(activity.state(visual,outside,outside,false)==energydeck::EvChargingActivity::WAIT);
  activity.observe(outside+10,true);
  assert(activity.state(visual,outside,outside,false)==energydeck::EvChargingActivity::CHARGING);
  assert(activity.state(visual,outside,outside+900,false)==energydeck::EvChargingActivity::CHARGING);
  assert(activity.state(visual,outside+900,outside,false)==energydeck::EvChargingActivity::WAIT);
  for(size_t i=0;i<p.window_count;++i) std::cout<<p.windows[i].from<<" "<<p.windows[i].until<<"\n";
}
