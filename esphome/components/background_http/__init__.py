"""Serialize HTTP off the display loop and publish replies after UI input settles."""
from esphome import automation
import esphome.codegen as cg
import esphome.config_validation as cv
from esphome.const import CONF_ID, CONF_URL, CONF_TIMEOUT, CONF_ON_RESPONSE, CONF_ON_ERROR

DEPENDENCIES = ["http_request", "ui_performance"]
ns = cg.esphome_ns.namespace("background_http")
BackgroundHttp = ns.class_("BackgroundHttp", cg.Component)
Reply = ns.struct("Reply")
SendAction = ns.class_("SendAction", automation.Action)
CONFIG_SCHEMA = cv.Schema({
    cv.GenerateID(): cv.declare_id(BackgroundHttp),
    cv.Optional(CONF_TIMEOUT, default="8s"): cv.positive_time_period_milliseconds,
}).extend(cv.COMPONENT_SCHEMA)

async def to_code(config):
    var = cg.new_Pvariable(config[CONF_ID])
    cg.add(var.set_timeout(config[CONF_TIMEOUT]))
    await cg.register_component(var, config)

ACTION_SCHEMA = cv.Schema({
    cv.GenerateID(): cv.use_id(BackgroundHttp),
    cv.Required(CONF_URL): cv.templatable(cv.url),
    cv.Optional("request_headers", default={}): cv.Schema({cv.string: cv.templatable(cv.string)}),
    cv.Optional("body", default=""): cv.templatable(cv.string),
    # All EnergyDeck consumers require a complete body, never progressive JSON.
    cv.Optional("capture_response", default=True): cv.one_of(True),
    cv.Optional("max_response_buffer_size", default=32768): cv.int_range(min=1, max=524288),
    cv.Optional("priority", default="data"): cv.enum({"control": 0, "data": 1, "artwork": 2}),
    cv.Optional(CONF_ON_RESPONSE): automation.validate_automation(single=True),
    cv.Optional(CONF_ON_ERROR): automation.validate_automation(single=True),
})

@automation.register_action("background_http.get", SendAction, ACTION_SCHEMA, synchronous=False)
async def get_to_code(config, action_id, template_arg, args):
    return await action_to_code(config, action_id, template_arg, args, "GET")

@automation.register_action("background_http.post", SendAction, ACTION_SCHEMA, synchronous=False)
async def post_to_code(config, action_id, template_arg, args):
    return await action_to_code(config, action_id, template_arg, args, "POST")

async def action_to_code(config, action_id, template_arg, args, method):
    parent = await cg.get_variable(config[CONF_ID])
    var = cg.new_Pvariable(action_id, template_arg, parent)
    cg.add(var.set_url(await cg.templatable(config[CONF_URL], args, cg.std_string)))
    cg.add(var.set_body(await cg.templatable(config["body"], args, cg.std_string)))
    cg.add(var.set_method(method))
    cg.add(var.set_max_bytes(config["max_response_buffer_size"]))
    cg.add(var.set_priority(0 if method == "POST" else config["priority"]))
    for name, value in config["request_headers"].items():
        cg.add(var.add_header(name, await cg.templatable(value, args, cg.std_string)))
    if response := config.get(CONF_ON_RESPONSE):
        await automation.build_automation(var.get_success_trigger(), [
            (cg.std_shared_ptr.template(Reply), "response"), (cg.std_string_ref, "body"), *args,
        ], response)
    if error := config.get(CONF_ON_ERROR):
        await automation.build_automation(var.get_error_trigger(), args, error)
    return var
