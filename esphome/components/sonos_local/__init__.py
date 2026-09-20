"""Expose the shared Sonos model before ESPHome generates typed globals."""
from esphome import config_validation as cv

CONFIG_SCHEMA = cv.Schema({})


async def to_code(config):
    # Model-only component: YAML scripts own HTTP scheduling and the UI.
    pass
