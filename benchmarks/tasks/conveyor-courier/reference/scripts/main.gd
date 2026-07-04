extends Node2D

const BoardModelScript: GDScript = preload("res://scripts/board_model.gd")
const SEED: int = 12345
const CELL_SIZE: int = 56
const BOARD_OFFSET: Vector2 = Vector2(32, 92)
const TICK_SECONDS: float = 0.5

var _model: BoardModel
var _selected_belt: BoardModel.CellKind = BoardModel.CellKind.BELT_UP
var _accumulator: float = 0.0
var _hud: Label
var _message: Label

func _ready() -> void:
	_hud = Label.new()
	_hud.position = Vector2(24, 18)
	_hud.add_theme_font_size_override("font_size", 18)
	add_child(_hud)

	_message = Label.new()
	_message.position = Vector2(520, 92)
	_message.add_theme_font_size_override("font_size", 26)
	add_child(_message)
	_restart()

func _process(delta: float) -> void:
	if not _model.is_finished():
		_accumulator += delta
		while _accumulator >= TICK_SECONDS and not _model.is_finished():
			_accumulator -= TICK_SECONDS
			_model.step_tick()
	_update_hud()
	queue_redraw()

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo:
		var key_event: InputEventKey = event
		match key_event.keycode:
			KEY_1:
				_selected_belt = BoardModel.CellKind.BELT_UP
			KEY_2:
				_selected_belt = BoardModel.CellKind.BELT_RIGHT
			KEY_3:
				_selected_belt = BoardModel.CellKind.BELT_DOWN
			KEY_4:
				_selected_belt = BoardModel.CellKind.BELT_LEFT
			KEY_R:
				_restart()
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		var mouse_event: InputEventMouseButton = event
		var cell: Vector2i = _screen_to_cell(mouse_event.position)
		if _model.get_cell(cell) == BoardModel.CellKind.EMPTY:
			_model.place_belt(cell, _selected_belt)
		elif _is_belt(_model.get_cell(cell)):
			_model.rotate_cell(cell)

func _draw() -> void:
	for y: int in range(BoardModel.HEIGHT):
		for x: int in range(BoardModel.WIDTH):
			var pos: Vector2i = Vector2i(x, y)
			var rect: Rect2 = Rect2(BOARD_OFFSET + Vector2(x * CELL_SIZE, y * CELL_SIZE), Vector2(CELL_SIZE, CELL_SIZE))
			_draw_cell(rect, _model.get_cell(pos))
	for item: BoardModel.ItemSnapshot in _model.get_items():
		var center: Vector2 = BOARD_OFFSET + Vector2(item.pos.x * CELL_SIZE, item.pos.y * CELL_SIZE) + Vector2(CELL_SIZE, CELL_SIZE) * 0.5
		var color: Color = Color(0.9, 0.12, 0.1)
		if item.kind == BoardModel.ItemKind.BLUE:
			color = Color(0.1, 0.32, 0.95)
		draw_circle(center, CELL_SIZE * 0.28, color)
		draw_circle(center, CELL_SIZE * 0.28, Color.BLACK, false, 2.0)

func _draw_cell(rect: Rect2, kind: BoardModel.CellKind) -> void:
	var fill: Color = Color(0.14, 0.15, 0.16)
	match kind:
		BoardModel.CellKind.EMPTY:
			fill = Color(0.20, 0.21, 0.22)
		BoardModel.CellKind.BLOCK:
			fill = Color(0.04, 0.04, 0.04)
		BoardModel.CellKind.EXIT_RED:
			fill = Color(0.44, 0.08, 0.07)
		BoardModel.CellKind.EXIT_BLUE:
			fill = Color(0.05, 0.16, 0.46)
		BoardModel.CellKind.SPAWN:
			fill = Color(0.10, 0.36, 0.20)
		BoardModel.CellKind.SPLITTER:
			fill = Color(0.45, 0.34, 0.08)
		_:
			fill = Color(0.28, 0.29, 0.31)
	draw_rect(rect, fill)
	draw_rect(rect, Color(0.62, 0.64, 0.66), false, 1.0)

	if _is_belt(kind) or kind == BoardModel.CellKind.SPAWN:
		_draw_arrow(rect, _direction_for_cell(kind), Color(0.92, 0.92, 0.86))
	elif kind == BoardModel.CellKind.SPLITTER:
		_draw_splitter(rect)
	elif kind == BoardModel.CellKind.EXIT_RED:
		_draw_label_in_cell(rect, "R", Color.WHITE)
	elif kind == BoardModel.CellKind.EXIT_BLUE:
		_draw_label_in_cell(rect, "B", Color.WHITE)

func _draw_arrow(rect: Rect2, dir: Vector2i, color: Color) -> void:
	var center: Vector2 = rect.get_center()
	var vector: Vector2 = Vector2(dir)
	var side: Vector2 = Vector2(-vector.y, vector.x)
	var tip: Vector2 = center + vector * 18.0
	var back: Vector2 = center - vector * 16.0
	var points: PackedVector2Array = PackedVector2Array([tip, back + side * 11.0, back - side * 11.0])
	draw_colored_polygon(points, color)

func _draw_splitter(rect: Rect2) -> void:
	var center: Vector2 = rect.get_center()
	draw_line(center + Vector2(-16, 12), center + Vector2(0, -12), Color.WHITE, 4.0)
	draw_line(center + Vector2(16, 12), center + Vector2(0, -12), Color.WHITE, 4.0)

func _draw_label_in_cell(rect: Rect2, text: String, color: Color) -> void:
	var font: Font = ThemeDB.fallback_font
	var font_size: int = 28
	var text_size: Vector2 = font.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size)
	draw_string(font, rect.get_center() + Vector2(-text_size.x * 0.5, text_size.y * 0.35), text, HORIZONTAL_ALIGNMENT_LEFT, -1, font_size, color)

func _restart() -> void:
	_model = BoardModelScript.new()
	_model.setup(_standard_map(), SEED)
	_accumulator = 0.0
	_update_hud()
	queue_redraw()

func _standard_map() -> PackedStringArray:
	return PackedStringArray([
		"........",
		"I>>>>v..",
		".....v..",
		".....v>R",
		".....v..",
		".....>>B",
		"........",
		"........",
	])

func _update_hud() -> void:
	var next_kind: String = "RED"
	if _model.peek_next_kind() == BoardModel.ItemKind.BLUE:
		next_kind = "BLUE"
	_hud.text = "Score: %d  Misses: %d  Ticks left: %d  Next: %s  Belt: %s" % [
		_model.get_score(),
		_model.get_misses(),
		max(0, BoardModel.TOTAL_TICKS - _model.get_tick()),
		next_kind,
		_belt_name(_selected_belt),
	]
	if _model.is_finished():
		var outcome: String = "LOSE"
		if _model.get_score() >= BoardModel.WIN_SCORE:
			outcome = "WIN"
		_message.text = "%s\nFinal score: %d" % [outcome, _model.get_score()]
	else:
		_message.text = ""

func _screen_to_cell(screen_pos: Vector2) -> Vector2i:
	var local: Vector2 = screen_pos - BOARD_OFFSET
	return Vector2i(floori(local.x / CELL_SIZE), floori(local.y / CELL_SIZE))

func _direction_for_cell(kind: BoardModel.CellKind) -> Vector2i:
	match kind:
		BoardModel.CellKind.BELT_UP:
			return BoardModel.UP
		BoardModel.CellKind.BELT_RIGHT, BoardModel.CellKind.SPAWN:
			return BoardModel.RIGHT
		BoardModel.CellKind.BELT_DOWN:
			return BoardModel.DOWN
		BoardModel.CellKind.BELT_LEFT:
			return BoardModel.LEFT
		_:
			return Vector2i.ZERO

func _belt_name(kind: BoardModel.CellKind) -> String:
	match kind:
		BoardModel.CellKind.BELT_UP:
			return "UP"
		BoardModel.CellKind.BELT_RIGHT:
			return "RIGHT"
		BoardModel.CellKind.BELT_DOWN:
			return "DOWN"
		BoardModel.CellKind.BELT_LEFT:
			return "LEFT"
		_:
			return "?"

func _is_belt(kind: BoardModel.CellKind) -> bool:
	return kind == BoardModel.CellKind.BELT_UP or kind == BoardModel.CellKind.BELT_RIGHT or kind == BoardModel.CellKind.BELT_DOWN or kind == BoardModel.CellKind.BELT_LEFT
