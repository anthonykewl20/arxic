# Footer actions — real mobile and tablet regressions

Status: in progress. Parent issue #456. Agent screenshot inspection found that Back and Save were separated by the explanatory paragraph at mobile widths. A real Chromium check fails in both themes with a 114 CSS-pixel top-edge difference (`row-red/`, two failures, 7.56 seconds).

Moving the explanation before the action pair fixes that row but exposes a second failed requirement: 32-pixel action heights at 768 pixels (`target-red/`, two failures, 10.03 seconds). The proposed implementation keeps Back then Save in DOM/keyboard order and gives dialog-footer buttons a 44-pixel minimum height. These are explicit usability requirements, not a claim that 32-pixel buttons universally violate WCAG.

The tests require the same action row, 44-pixel minimum height, footer text within bounds, and unobstructed sampled line centers at 320/390/768/1440 in both themes. Existing axe violations and incomplete results are retained. No contrast workaround or audit waiver ships. Real multi-browser and installed CI acceptance remain pending. No independent human inspection is claimed.

Revised source dashboard journeys pass in Chromium (2 cases, 33.18 s) and Firefox (2 cases, 46.44 s). Adjacent provenance records the dirty implementation based on `1559b3d5`; these are not clean installed final-head proofs. Agent inspection of the Chromium 320-pixel light capture confirms explanation above adjacent Back/Save controls. Initial placement of the 44-pixel CSS rule inside the components layer lost to the button utility; its failed rerun remained at 32 pixels and the rule was moved to the same unlayered override level as the responsive controls. Assertions were not changed.

WebKit also passes both themes (2 cases, 35.92 s). Agent inspection includes its 768-pixel dark footer: caption remains left of the adjacent 44-pixel Back/Save controls without clipping. The native incomplete contrast records remain unchanged in meaning; these six passing functional journeys do not establish full WCAG conformance.

The broader Chromium navigation/keyboard audit passes (1 case, 35.36 s): URL/refresh/Back navigation, light/dark responsive routes, search control alignment, centered modal, Tab containment, Escape focus restoration, forced colors and session-expiry recovery. `navigation/` retains its masked screenshots and sanitized timeline. Installed final-head acceptance remains owed.
