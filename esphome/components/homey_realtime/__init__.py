"""Consume scoped Homey Socket.IO notifications away from the display loop."""
from esphome import automation
import esphome.codegen as cg
import esphome.config_validation as cv
from esphome.core import CORE
from esphome.const import CONF_ID

DEPENDENCIES = ["background_http", "json", "ui_performance"]
ns = cg.esphome_ns.namespace("homey_realtime")
HomeyRealtime = ns.class_("HomeyRealtime", cg.Component)
CONFIG_SCHEMA = cv.Schema({
    cv.GenerateID(): cv.declare_id(HomeyRealtime),
    cv.Required("address"): cv.url,
    cv.Required("token"): cv.string,
    cv.Optional("devices", default=[]): cv.All(cv.ensure_list(cv.string), cv.Length(max=31)),
    cv.Optional("climate_devices", default=[]): cv.All(cv.ensure_list(cv.string), cv.Length(max=10)),
    cv.Optional("price_variable", default=""): cv.string,
    cv.Optional("on_change"): automation.validate_automation(single=True),
}).extend(cv.COMPONENT_SCHEMA)

async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    await cg.register_component(var, config)
    cg.add(var.set_address(config["address"]))
    cg.add(var.set_token(config["token"]))
    for device in config["devices"]:
        cg.add(var.add_device(device))
    for device in config["climate_devices"]:
        cg.add(var.add_device(device, "climate"))
    cg.add(var.set_price_variable(config["price_variable"]))
    if trigger := config.get("on_change"):
        await automation.build_automation(var.get_change_trigger(), [(cg.std_string, "entity_id")], trigger)
    if CORE.is_esp32:
        from esphome.components import esp32
        esp32.include_builtin_idf_component("tcp_transport")
        esp32.add_idf_sdkconfig_option("CONFIG_WS_TRANSPORT", True)
    elif CORE.is_host:
        # Match the HTTP host transport's existing OpenSSL dependency.
        cg.add_build_flag("-lssl")
        cg.add_build_flag("-lcrypto")
