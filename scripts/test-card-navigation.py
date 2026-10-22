"""Exercise all compact-card click branches without running device scripts."""
from pathlib import Path
import re
import yaml


class DashboardLoader(yaml.SafeLoader):
    pass


# Includes are unrelated to these three top-level buttons and need not be expanded.
DashboardLoader.add_constructor("!include", lambda loader, node: loader.construct_scalar(node))
root = Path(__file__).resolve().parents[1]
dashboard = yaml.load((root / "esphome/packages/dashboard.yaml").read_text(), Loader=DashboardLoader)
buttons = {item["button"]["id"]: item["button"]
           for item in dashboard["lvgl"]["pages"][0]["widgets"] if "button" in item}


def run(actions, selected, calls):
    for action in actions:
        if "if" in action:
            branch = action["if"]
            condition = re.fullmatch(r"return id\(detail_tab\) == ([012]);", branch["condition"]["lambda"])
            assert condition, "Navigation must compare the currently visible compact card"
            selected = run(branch["then"] if selected == int(condition[1]) else branch["else"], selected, calls)
        elif "globals.set" in action:
            assert action["globals.set"]["id"] == "detail_tab"
            selected = int(action["globals.set"]["value"])
        else:
            assert set(action) == {"script.execute"}, "Unexpected navigation side effect"
            calls.append(action["script.execute"])
    return selected


for target, (button, detail) in enumerate([
    ("gas_tab", "open_energy_page"), ("music_tab", "open_music_page"), ("extra_tab", "open_climate_page")
]):
    for current in range(3):
        calls = []
        selected = run(buttons[button]["on_click"], current, calls)
        assert selected == target
        assert calls == ([detail] if current == target else ["select_detail_tab"])
        # A second tap on the newly selected card opens exactly its detail page.
        calls = []
        assert run(buttons[button]["on_click"], selected, calls) == target
        assert calls == [detail]

assert buttons["gas_tab"]["text"] == "${gas_tab_title}"
print("PASS: all nine card transitions select first and open matching details on a repeat tap")
