extends SceneTree

const TEST_TICK: String = "tick advances at 0.5s interval"
const TEST_MOUSE: String = "mouse click places a belt"
const TEST_GLYPHS: String = "labels have no missing glyphs"

const BOOT_WAIT_SEC: float = 1.2
const CLICK_SETTLE_SEC: float = 0.4
const TICK_SAMPLE_SEC: float = 2.2
const TICK_INTERVAL_SEC: float = 0.5
const WIDTH: int = 8
const HEIGHT: int = 8
const CLICK_STEP_PX: int = 32
const BELT_NAMES: Array[String] = ["BELT_UP", "BELT_RIGHT", "BELT_DOWN", "BELT_LEFT"]
# 通常の空白に加え NBSP / 全角空白。グリフ有無の判定対象から除外する
const WHITESPACE_CODES: Array[int] = [9, 10, 13, 32, 0x00A0, 0x3000]

var _passed: int = 0
var _failed: int = 0
var _test_index: int = 0
var _tests: Array[Dictionary] = []
var _categories: Dictionary = {}

func _initialize() -> void:
	_run_async()

func _run_async() -> void:
	var packed: Variant = load("res://scenes/main.tscn")
	var scene: Node = null
	if packed is PackedScene:
		scene = (packed as PackedScene).instantiate()
	if scene == null:
		_fail_all("main.tscn load or instantiate failed")
		_finish()
		return
	root.add_child(scene)
	await create_timer(BOOT_WAIT_SEC).timeout
	_test_glyphs()
	var model: Variant = _find_model(root)
	# tick レートはクリック注入の負荷と干渉しないよう、マウステストより先に
	# クリーンな計測窓で測る
	var t0_ms: int = Time.get_ticks_msec()
	var tick_a: int = _model_tick(model)
	await create_timer(TICK_SAMPLE_SEC).timeout
	_test_tick_rate(model, tick_a, t0_ms)
	await _test_mouse(model)
	_finish()

func _fail_all(detail: String) -> void:
	_record(false, "view", TEST_TICK, detail)
	_record(false, "view", TEST_MOUSE, detail)
	_record(false, "view", TEST_GLYPHS, detail)

func _finish() -> void:
	var payload: Dictionary = {"passed": _passed, "failed": _failed, "categories": _categories, "tests": _tests}
	print("GRADE_JSON: %s" % JSON.stringify(payload))
	quit(0 if _failed == 0 else 1)

func _test_tick_rate(model: Variant, tick_a: int, t0_ms: int) -> void:
	if model == null:
		_record(false, "view", TEST_TICK, "board model instance not found in scene tree")
		return
	var tick_b: int = _model_tick(model)
	var elapsed_sec: float = float(Time.get_ticks_msec() - t0_ms) / 1000.0
	var expected: float = elapsed_sec / TICK_INTERVAL_SEC
	var delta_ticks: int = tick_b - tick_a
	# 起動直後のサンプルで既に大きく進んでいる高速化バグと、
	# サンプル間隔での進行レート異常の両方を検査する
	var boot_ok: bool = tick_a <= int(ceilf(BOOT_WAIT_SEC / TICK_INTERVAL_SEC)) + 2
	var rate_ok: bool = absf(float(delta_ticks) - expected) <= 2.0
	_record(boot_ok and rate_ok, "view", TEST_TICK, "tick_a=%d tick_b=%d elapsed=%.2fs expected_delta=%.1f" % [tick_a, tick_b, elapsed_sec, expected])

func _test_mouse(model: Variant) -> void:
	if model == null:
		_record(false, "view", TEST_MOUSE, "board model instance not found in scene tree")
		return
	var kinds: Dictionary = _cell_kinds(model)
	if not kinds.has("EMPTY"):
		_record(false, "view", TEST_MOUSE, "CellKind enum not found on board model")
		return
	var empty_value: int = int(kinds["EMPTY"])
	var belt_values: Array[int] = []
	for name: String in BELT_NAMES:
		if kinds.has(name):
			belt_values.append(int(kinds[name]))
	var empties: Array[Vector2i] = []
	for y: int in range(HEIGHT):
		for x: int in range(WIDTH):
			if int(model.call("get_cell", Vector2i(x, y))) == empty_value:
				empties.append(Vector2i(x, y))
	var size: Vector2i = _design_size()
	var clicks: int = 0
	for y_px: int in range(CLICK_STEP_PX / 2, size.y, CLICK_STEP_PX):
		for x_px: int in range(CLICK_STEP_PX / 2, size.x, CLICK_STEP_PX):
			_click(Vector2(float(x_px), float(y_px)))
			clicks += 1
		# クリックごとに View を全再構築する実装でイベント処理が飢餓しないよう、
		# 行単位でフレームを跨いで注入する
		await process_frame
	await create_timer(CLICK_SETTLE_SEC).timeout
	var placed: int = 0
	for pos: Vector2i in empties:
		if belt_values.has(int(model.call("get_cell", pos))):
			placed += 1
	var finished: bool = bool(model.call("is_finished"))
	# 全面クリックで空セルの過半数に設置できることを要求する。ごく一部だけ成功する
	# ケース（セル間の隙間に落ちたクリックのみ通るなど）は実質操作不能なので不合格
	var passed: bool = placed > 0 and placed * 2 >= empties.size()
	_record(passed, "view", TEST_MOUSE, "placed=%d clicks=%d empties=%d finished_during_test=%s" % [placed, clicks, empties.size(), str(finished)])

func _test_glyphs() -> void:
	var missing: Dictionary = {}
	_scan_glyphs(root, missing)
	# draw_string 等で直接描画される文字は scene 走査に現れないため、
	# View スクリプトの文字列リテラル中の非 ASCII 文字も既定フォントで検査する
	var literal_chars: Dictionary = {}
	_scan_script_literals("res://", literal_chars)
	for code: int in literal_chars.keys():
		if not ThemeDB.fallback_font.has_char(code):
			missing[code] = true
	var passed: bool = missing.is_empty()
	var detail: String = "ok"
	if not passed:
		var parts: Array[String] = []
		for code: int in missing.keys():
			parts.append("U+%04X" % code)
		detail = "missing glyphs: %s" % ", ".join(parts)
	_record(passed, "view", TEST_GLYPHS, detail)

func _scan_glyphs(node: Node, missing: Dictionary) -> void:
	var text: String = ""
	var font: Font = null
	if node is Label:
		text = (node as Label).text
		font = (node as Label).get_theme_font("font")
	elif node is RichTextLabel:
		text = (node as RichTextLabel).get_parsed_text()
		font = (node as RichTextLabel).get_theme_font("normal_font")
	if font != null:
		for i: int in range(text.length()):
			var code: int = text.unicode_at(i)
			if code > 32 and not WHITESPACE_CODES.has(code) and not font.has_char(code):
				missing[code] = true
	for child: Node in node.get_children():
		_scan_glyphs(child, missing)

func _scan_script_literals(dir_path: String, chars: Dictionary) -> void:
	var dir: DirAccess = DirAccess.open(dir_path)
	if dir == null:
		return
	dir.list_dir_begin()
	var entry: String = dir.get_next()
	while entry != "":
		var path: String = dir_path.path_join(entry)
		if dir.current_is_dir():
			if not entry.begins_with("."):
				_scan_script_literals(path, chars)
		elif entry.ends_with(".gd") and entry != "run_view_tests.gd" and entry != "run_tests.gd":
			_collect_literal_chars(FileAccess.get_file_as_string(path), chars)
		entry = dir.get_next()
	dir.list_dir_end()

func _collect_literal_chars(source: String, chars: Dictionary) -> void:
	var in_string: bool = false
	var quote: String = ""
	var i: int = 0
	while i < source.length():
		var ch: String = source[i]
		if in_string:
			if ch == "\\":
				i += 2
				continue
			if ch == quote:
				in_string = false
			else:
				var code: int = source.unicode_at(i)
				if code > 0x7F and not WHITESPACE_CODES.has(code):
					chars[code] = true
			i += 1
			continue
		if ch == "\"" or ch == "'":
			in_string = true
			quote = ch
		elif ch == "#":
			while i < source.length() and source[i] != "\n":
				i += 1
		i += 1

# headless の window は 100x100 にクランプされデザイン解像度と乖離するため、
# window 座標経由の変換を避けて viewport ローカル座標（デザイン座標）で直接注入する
func _click(position: Vector2) -> void:
	var press: InputEventMouseButton = InputEventMouseButton.new()
	press.button_index = MOUSE_BUTTON_LEFT
	press.pressed = true
	press.position = position
	press.global_position = position
	root.push_input(press, true)
	var release: InputEventMouseButton = InputEventMouseButton.new()
	release.button_index = MOUSE_BUTTON_LEFT
	release.pressed = false
	release.position = position
	release.global_position = position
	root.push_input(release, true)

func _design_size() -> Vector2i:
	var design: Vector2i = root.content_scale_size
	if design.x <= 0 or design.y <= 0:
		design = Vector2i(
			int(ProjectSettings.get_setting("display/window/size/viewport_width", 1152)),
			int(ProjectSettings.get_setting("display/window/size/viewport_height", 648))
		)
	return design

func _find_model(node: Node) -> Variant:
	for prop: Dictionary in node.get_property_list():
		if (int(prop.get("usage", 0)) & PROPERTY_USAGE_SCRIPT_VARIABLE) == 0:
			continue
		var value: Variant = node.get(String(prop.get("name", "")))
		if value is Object and is_instance_valid(value):
			var attached: Variant = (value as Object).get_script()
			if attached is Script and String((attached as Script).resource_path).ends_with("board_model.gd"):
				return value
	for child: Node in node.get_children():
		var found: Variant = _find_model(child)
		if found != null:
			return found
	return null

func _model_tick(model: Variant) -> int:
	if model == null:
		return -1
	return int(model.call("get_tick"))

func _cell_kinds(model: Variant) -> Dictionary:
	var attached: Variant = (model as Object).get_script()
	if attached is Script:
		var constants: Dictionary = (attached as Script).get_script_constant_map()
		var cell_enum: Variant = constants.get("CellKind", {})
		if cell_enum is Dictionary:
			return cell_enum
	return {}

func _record(passed: bool, category: String, name: String, detail: String = "") -> void:
	_test_index += 1
	if passed:
		_passed += 1
	else:
		_failed += 1
	if not _categories.has(category):
		_categories[category] = {"passed": 0, "failed": 0}
	var cat: Dictionary = _categories[category]
	cat["passed" if passed else "failed"] = int(cat["passed" if passed else "failed"]) + 1
	var status: String = "ok" if passed else "not ok"
	var suffix: String = "" if detail.is_empty() else " (%s)" % detail
	print("%s %d [%s] %s%s" % [status, _test_index, category, name, suffix])
	_tests.append({"n": _test_index, "category": category, "name": name, "passed": passed, "detail": detail})
