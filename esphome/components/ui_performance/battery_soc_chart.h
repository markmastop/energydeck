#pragma once
#include "battery_detail.h"
#include "energy_history.h"
#include "lvgl.h"

namespace energydeck {
// Draw in-place: no per-sample widgets or large setup/loop stack buffers.
struct BatterySocChart {
  lv_obj_t *plot{nullptr};
  const LineHistory *history{nullptr};
  const BatteryPlan *plan{nullptr};
  int64_t from{0}, until{0}, now{0};
  float live{NAN};
  int top{0}, height{0};
  void update(lv_obj_t *parent, const LineHistory *h, const BatteryPlan *p,
              int64_t a, int64_t b, uint32_t epoch, float current, int y, int size) {
    history=h; plan=p; from=a; until=b; now=epoch; live=current; top=y; height=size;
    if (!plot) {
      plot=parent;
      lv_obj_add_event_cb(plot, [](lv_event_t *event) {
        auto &c=*static_cast<BatterySocChart *>(lv_event_get_user_data(event));
        if(c.until<=c.from) return;
        lv_area_t area; lv_obj_get_coords(c.plot,&area);
        const int width=lv_area_get_width(&area)-1;
        auto segment=[&](int64_t a,float av,int64_t b,float bv,bool forecast) {
          if(b<=a || b<c.from || a>c.until) return;
          const int64_t left=std::max(a,c.from),right=std::min(b,c.until);
          const float first=av+(bv-av)*double(left-a)/(b-a),last=av+(bv-av)*double(right-a)/(b-a);
          lv_draw_line_dsc_t d;lv_draw_line_dsc_init(&d);
          const auto x=[&](int64_t t){return area.x1+int(double(t-c.from)/(c.until-c.from)*width);};
          d.p1={lv_value_precise_t(x(left)),lv_value_precise_t(area.y1+c.top+BatteryDetailGeometry::soc_y(first,c.height))};
          d.p2={lv_value_precise_t(x(right)),lv_value_precise_t(area.y1+c.top+BatteryDetailGeometry::soc_y(last,c.height))};
          d.color=lv_color_hex(0x48BD70);d.width=2;
          if(!forecast) { lv_draw_line(lv_event_get_layer(event),&d); return; }
          // LVGL software dashes support only horizontal/vertical lines. Split
          // diagonals ourselves; screen-x phase keeps dashes across quarter joins.
          const auto first_point=d.p1,last_point=d.p2;
          const float span=last_point.x-first_point.x;
          if(span<=0) return;
          for(int dash=int(first_point.x)/7*7;dash<last_point.x;dash+=7) {
            const float a=std::max(float(first_point.x),float(dash)), b=std::min(float(last_point.x),float(dash+4));
            if(b<=a) continue;
            d.p1={lv_value_precise_t(a),lv_value_precise_t(first_point.y+(last_point.y-first_point.y)*(a-first_point.x)/span)};
            d.p2={lv_value_precise_t(b),lv_value_precise_t(first_point.y+(last_point.y-first_point.y)*(b-first_point.x)/span)};
            lv_draw_line(lv_event_get_layer(event),&d);
          }
        };
        battery_soc_segments(c.history,c.plan,c.now,c.live,segment);
      },LV_EVENT_DRAW_POST,this);
    }
    lv_obj_invalidate(plot);
  }
};
}  // namespace energydeck
