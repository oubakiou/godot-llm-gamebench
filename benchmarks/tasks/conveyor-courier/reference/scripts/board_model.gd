class_name BoardModel
extends RefCounted

enum CellKind { EMPTY, BELT_UP, BELT_RIGHT, BELT_DOWN, BELT_LEFT, SPLITTER, BLOCK, EXIT_RED, EXIT_BLUE, SPAWN }
enum ItemKind { RED, BLUE }

class ItemSnapshot:
	extends RefCounted
	var id: int
	var kind: BoardModel.ItemKind
	var pos: Vector2i
	var dir: Vector2i

class StepResult:
	extends RefCounted
	var tick: int
	var spawned: Array[int]
	var delivered: Array[int]
	var missed: Array[int]
	var finished: bool

class _Item:
	extends RefCounted
	var id: int
	var kind: BoardModel.ItemKind
	var pos: Vector2i
	var dir: Vector2i
	var stuck_count: int

class _Intent:
	extends RefCounted
	var item: _Item
	var from_pos: Vector2i
	var target: Vector2i
	var direction: Vector2i
	var from_splitter: bool
	var departed: bool
	var moved: bool

const WIDTH: int = 8
const HEIGHT: int = 8
const TOTAL_TICKS: int = 120
const SPAWN_INTERVAL: int = 3
const STUCK_LIMIT: int = 5
const WIN_SCORE: int = 20
const UP: Vector2i = Vector2i(0, -1)
const RIGHT: Vector2i = Vector2i(1, 0)
const DOWN: Vector2i = Vector2i(0, 1)
const LEFT: Vector2i = Vector2i(-1, 0)

var _grid: Array[Array] = []
var _items: Array[_Item] = []
var _next_id: int = 0
var _tick: int = 0
var _score: int = 0
var _misses: int = 0
var _finished: bool = false
var _spawn_pos: Vector2i = Vector2i.ZERO
var _rng: RandomNumberGenerator = RandomNumberGenerator.new()
var _splitter_right_next: Dictionary = {}

func setup(map: PackedStringArray, rng_seed: int) -> void:
	_grid.clear()
	_items.clear()
	_next_id = 0
	_tick = 0
	_score = 0
	_misses = 0
	_finished = false
	_spawn_pos = Vector2i.ZERO
	_splitter_right_next.clear()
	_rng = RandomNumberGenerator.new()
	_rng.seed = rng_seed

	for y: int in range(HEIGHT):
		var row: Array[CellKind] = []
		var line: String = ""
		if y < map.size():
			line = map[y]
		for x: int in range(WIDTH):
			var kind: CellKind = CellKind.EMPTY
			if x < line.length():
				kind = _char_to_cell(line[x])
			var pos: Vector2i = Vector2i(x, y)
			if kind == CellKind.SPAWN:
				_spawn_pos = pos
			elif kind == CellKind.SPLITTER:
				_splitter_right_next[pos] = true
			row.append(kind)
		_grid.append(row)

func step_tick() -> StepResult:
	if _finished:
		var already_finished_result: StepResult = _new_step_result()
		already_finished_result.finished = true
		return already_finished_result

	_tick += 1
	var result: StepResult = _new_step_result()
	var intents: Array[_Intent] = _build_intents()
	var departed_ids: Dictionary = {}
	var moved_ids: Dictionary = {}
	var occupancy: Dictionary = _build_occupancy()

	for intent: _Intent in intents:
		var target_kind: CellKind = get_cell(intent.target)
		if not _is_inside(intent.target) or target_kind == CellKind.EXIT_RED or target_kind == CellKind.EXIT_BLUE:
			intent.departed = true
			departed_ids[intent.item.id] = true
			occupancy.erase(intent.from_pos)
			if intent.from_splitter:
				_flip_splitter(intent.from_pos)
			if not _is_inside(intent.target):
				result.missed.append(intent.item.id)
				_misses += 1
			elif _exit_matches_item(target_kind, intent.item.kind):
				result.delivered.append(intent.item.id)
				_score += 1
			else:
				result.missed.append(intent.item.id)
				_misses += 1

	var moved_in_pass: bool = true
	while moved_in_pass:
		moved_in_pass = false
		for intent: _Intent in intents:
			if intent.departed or intent.moved:
				continue
			if not _is_inside(intent.target) or not _is_walkable(get_cell(intent.target)):
				continue
			if occupancy.has(intent.target):
				continue
			occupancy.erase(intent.from_pos)
			occupancy[intent.target] = intent.item.id
			intent.item.pos = intent.target
			intent.item.dir = intent.direction
			intent.item.stuck_count = 0
			intent.moved = true
			moved_ids[intent.item.id] = true
			moved_in_pass = true
			if intent.from_splitter:
				_flip_splitter(intent.from_pos)

	var removed_stuck_ids: Array[int] = []
	for item: _Item in _items:
		if departed_ids.has(item.id) or moved_ids.has(item.id):
			continue
		item.stuck_count += 1
		if item.stuck_count >= STUCK_LIMIT:
			removed_stuck_ids.append(item.id)
			result.missed.append(item.id)
			_misses += 1

	_remove_ids(departed_ids)
	for id: int in removed_stuck_ids:
		departed_ids[id] = true
	_remove_ids(departed_ids)

	if (_tick - 1) % SPAWN_INTERVAL == 0:
		_spawn_from_rng(result)

	if _tick == TOTAL_TICKS:
		_finished = true
	result.finished = _finished
	result.spawned.sort()
	result.delivered.sort()
	result.missed.sort()
	return result

func place_belt(pos: Vector2i, kind: CellKind) -> bool:
	if not _is_inside(pos):
		return false
	if get_cell(pos) != CellKind.EMPTY:
		return false
	if not _is_belt(kind):
		return false
	_grid[pos.y][pos.x] = kind
	return true

func rotate_cell(pos: Vector2i) -> bool:
	if not _is_inside(pos):
		return false
	var kind: CellKind = get_cell(pos)
	if not _is_belt(kind):
		return false
	match kind:
		CellKind.BELT_UP:
			_grid[pos.y][pos.x] = CellKind.BELT_RIGHT
		CellKind.BELT_RIGHT:
			_grid[pos.y][pos.x] = CellKind.BELT_DOWN
		CellKind.BELT_DOWN:
			_grid[pos.y][pos.x] = CellKind.BELT_LEFT
		CellKind.BELT_LEFT:
			_grid[pos.y][pos.x] = CellKind.BELT_UP
		_:
			return false
	return true

func spawn_item(kind: ItemKind, pos: Vector2i, dir: Vector2i) -> int:
	if not _is_inside(pos):
		return -1
	if not _is_walkable(get_cell(pos)):
		return -1
	if not _is_direction(dir):
		return -1
	if _item_at(pos) != null:
		return -1
	var item: _Item = _new_item(kind, pos, dir)
	_items.append(item)
	_sort_items()
	return item.id

func peek_next_kind() -> ItemKind:
	var clone: RandomNumberGenerator = RandomNumberGenerator.new()
	clone.seed = _rng.seed
	clone.state = _rng.state
	return _kind_from_random(clone.randi())

func get_cell(pos: Vector2i) -> CellKind:
	if not _is_inside(pos):
		return CellKind.EMPTY
	return _grid[pos.y][pos.x]

func get_items() -> Array[ItemSnapshot]:
	_sort_items()
	var snapshots: Array[ItemSnapshot] = []
	for item: _Item in _items:
		var snapshot: ItemSnapshot = ItemSnapshot.new()
		snapshot.id = item.id
		snapshot.kind = item.kind
		snapshot.pos = item.pos
		snapshot.dir = item.dir
		snapshots.append(snapshot)
	return snapshots

func get_score() -> int:
	return _score

func get_misses() -> int:
	return _misses

func get_tick() -> int:
	return _tick

func is_finished() -> bool:
	return _finished

func _new_step_result() -> StepResult:
	var result: StepResult = StepResult.new()
	result.tick = _tick
	result.spawned = []
	result.delivered = []
	result.missed = []
	result.finished = _finished
	return result

func _build_intents() -> Array[_Intent]:
	_sort_items()
	var intents: Array[_Intent] = []
	for item: _Item in _items:
		var intent: _Intent = _Intent.new()
		intent.item = item
		intent.from_pos = item.pos
		intent.direction = _direction_for_item(item)
		intent.target = item.pos + intent.direction
		intent.from_splitter = get_cell(item.pos) == CellKind.SPLITTER
		intent.departed = false
		intent.moved = false
		intents.append(intent)
	return intents

func _direction_for_item(item: _Item) -> Vector2i:
	var kind: CellKind = get_cell(item.pos)
	if kind == CellKind.SPLITTER:
		if bool(_splitter_right_next.get(item.pos, true)):
			return Vector2i(-item.dir.y, item.dir.x)
		return Vector2i(item.dir.y, -item.dir.x)
	return _direction_for_cell(kind)

func _direction_for_cell(kind: CellKind) -> Vector2i:
	match kind:
		CellKind.BELT_UP:
			return UP
		CellKind.BELT_RIGHT, CellKind.SPAWN:
			return RIGHT
		CellKind.BELT_DOWN:
			return DOWN
		CellKind.BELT_LEFT:
			return LEFT
		_:
			return Vector2i.ZERO

func _build_occupancy() -> Dictionary:
	var occupancy: Dictionary = {}
	for item: _Item in _items:
		occupancy[item.pos] = item.id
	return occupancy

func _spawn_from_rng(result: StepResult) -> void:
	var kind: ItemKind = _kind_from_random(_rng.randi())
	var id: int = _next_id
	_next_id += 1
	if _item_at(_spawn_pos) != null:
		result.missed.append(id)
		_misses += 1
		return
	var item: _Item = _new_item_with_id(id, kind, _spawn_pos, RIGHT)
	_items.append(item)
	_sort_items()
	result.spawned.append(id)

func _new_item(kind: ItemKind, pos: Vector2i, dir: Vector2i) -> _Item:
	var id: int = _next_id
	_next_id += 1
	return _new_item_with_id(id, kind, pos, dir)

func _new_item_with_id(id: int, kind: ItemKind, pos: Vector2i, dir: Vector2i) -> _Item:
	var item: _Item = _Item.new()
	item.id = id
	item.kind = kind
	item.pos = pos
	item.dir = dir
	item.stuck_count = 0
	return item

func _remove_ids(ids: Dictionary) -> void:
	if ids.is_empty():
		return
	var kept: Array[_Item] = []
	for item: _Item in _items:
		if not ids.has(item.id):
			kept.append(item)
	_items = kept

func _sort_items() -> void:
	_items.sort_custom(func(a: _Item, b: _Item) -> bool: return a.id < b.id)

func _item_at(pos: Vector2i) -> _Item:
	for item: _Item in _items:
		if item.pos == pos:
			return item
	return null

func _flip_splitter(pos: Vector2i) -> void:
	_splitter_right_next[pos] = not bool(_splitter_right_next.get(pos, true))

func _exit_matches_item(cell: CellKind, kind: ItemKind) -> bool:
	return (cell == CellKind.EXIT_RED and kind == ItemKind.RED) or (cell == CellKind.EXIT_BLUE and kind == ItemKind.BLUE)

func _kind_from_random(value: int) -> ItemKind:
	if value % 2 == 0:
		return ItemKind.RED
	return ItemKind.BLUE

func _char_to_cell(ch: String) -> CellKind:
	match ch:
		"^":
			return CellKind.BELT_UP
		">":
			return CellKind.BELT_RIGHT
		"v":
			return CellKind.BELT_DOWN
		"<":
			return CellKind.BELT_LEFT
		"S":
			return CellKind.SPLITTER
		"#":
			return CellKind.BLOCK
		"R":
			return CellKind.EXIT_RED
		"B":
			return CellKind.EXIT_BLUE
		"I":
			return CellKind.SPAWN
		_:
			return CellKind.EMPTY

func _is_inside(pos: Vector2i) -> bool:
	return pos.x >= 0 and pos.x < WIDTH and pos.y >= 0 and pos.y < HEIGHT

func _is_belt(kind: CellKind) -> bool:
	return kind == CellKind.BELT_UP or kind == CellKind.BELT_RIGHT or kind == CellKind.BELT_DOWN or kind == CellKind.BELT_LEFT

func _is_walkable(kind: CellKind) -> bool:
	return _is_belt(kind) or kind == CellKind.SPLITTER or kind == CellKind.SPAWN

func _is_direction(dir: Vector2i) -> bool:
	return dir == UP or dir == RIGHT or dir == DOWN or dir == LEFT
