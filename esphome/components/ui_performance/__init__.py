"""Measure LVGL rendering without changing navigation or network state."""
import esphome.codegen as cg
import esphome.config_validation as cv
from esphome.components.rpi_dpi_rgb.display import RPI_DPI_RGB
from esphome.const import CONF_ID

DEPENDENCIES = ["lvgl"]
ns = cg.esphome_ns.namespace("ui_performance")
UiPerformance = ns.class_("UiPerformance", cg.Component)
CONFIG_SCHEMA = cv.Schema({
    cv.GenerateID(): cv.declare_id(UiPerformance),
    cv.Optional("benchmark_redraws", default=0): cv.int_range(min=0, max=10),
    # The tiled path preserves the CrowPanel RGB driver's existing byte order.
    cv.Optional("display_id"): cv.use_id(RPI_DPI_RGB),
    cv.Optional("tiled_rotation", default=True): cv.boolean,
}).extend(cv.COMPONENT_SCHEMA)

async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    await cg.register_component(var, config)
    cg.add(var.set_benchmark_redraws(config["benchmark_redraws"]))
    if "display_id" in config:
        panel = await cg.get_variable(config["display_id"])
        cg.add(var.set_display(panel, config["tiled_rotation"]))
