"""Keep Sonos SOAP I/O off the display's main event loop."""
import esphome.codegen as cg
import esphome.config_validation as cv
from esphome.const import CONF_ID

DEPENDENCIES = ["sonos_local", "http_request"]
ns = cg.esphome_ns.namespace("sonos_http")
SonosHttp = ns.class_("SonosHttp", cg.Component)
CONFIG_SCHEMA = cv.Schema({
    cv.GenerateID(): cv.declare_id(SonosHttp),
}).extend(cv.COMPONENT_SCHEMA)


async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    await cg.register_component(var, config)
