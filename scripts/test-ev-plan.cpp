#include "../esphome/components/ui_performance/ev_plan.h"
#include <iostream>
#include <cstdlib>
int main(int argc,char **argv) {
  if(argc!=3) return 1;
  setenv("TZ","Europe/Amsterdam",1);tzset();
  energydeck::PriceDay a,b;
  a.start=std::atoll(argv[1]);a.count=std::atoi(argv[2]);a.end=a.start+a.count*900;
  b.start=a.end;b.count=96;b.end=b.start+86400;
  for(int i=0;i<a.count;++i)a.values[i]=(i*13)%31-5;
  for(int i=0;i<b.count;++i)b.values[i]=(i*7)%23-3;
  energydeck::EvChargingPlan p;p.build(a,&b);
  for(size_t i=0;i<p.window_count;++i) std::cout<<p.windows[i].from<<" "<<p.windows[i].until<<"\n";
}
