extends SceneTree

const TOTAL_TESTS: int = 33
const WIDTH: int = 8
const HEIGHT: int = 8
const TOTAL_TICKS: int = 120
const SPAWN_INTERVAL: int = 3
const STUCK_LIMIT: int = 5
const STANDARD_MAP: PackedStringArray = [
	"........",
	"I>>>>v..",
	".....v..",
	".....v>R",
	".....v..",
	".....>>B",
	"........",
	"........",
]
const DIR_UP: Vector2i = Vector2i(0, -1)
const DIR_RIGHT: Vector2i = Vector2i(1, 0)
const DIR_DOWN: Vector2i = Vector2i(0, 1)
const DIR_LEFT: Vector2i = Vector2i(-1, 0)
const DIRS: Array[Vector2i] = [DIR_UP, DIR_RIGHT, DIR_DOWN, DIR_LEFT]
const CONTRACT_METHODS: Array[String] = [
	"setup",
	"step_tick",
	"place_belt",
	"rotate_cell",
	"spawn_item",
	"peek_next_kind",
	"get_cell",
	"get_items",
	"get_score",
	"get_misses",
	"get_tick",
	"is_finished",
]
const CELL_NAMES: Array[String] = [
	"EMPTY",
	"BELT_UP",
	"BELT_RIGHT",
	"BELT_DOWN",
	"BELT_LEFT",
	"SPLITTER",
	"BLOCK",
	"EXIT_RED",
	"EXIT_BLUE",
	"SPAWN",
]
const ITEM_NAMES: Array[String] = ["RED", "BLUE"]

var _board_script: Variant = null
var _cell: Dictionary = {}
var _item: Dictionary = {}
var _passed: int = 0
var _failed: int = 0
var _test_index: int = 0
var _tests: Array[Dictionary] = []
var _categories: Dictionary = {}

func _init() -> void:
	_run_all()
	_print_grade()
	quit(0 if _failed == 0 else 1)

func _run_all() -> void:
	var contract_ok: bool = _test_contract()
	if not contract_ok:
		_fail_remaining_after_contract()
		return
	_test_setup_initial_state()
	_test_acceptance_spawn_and_move()
	_test_get_cell_ascii_and_outside()
	_test_place_belt_rules()
	_test_rotate_cell_rules()
	_test_spawn_item_rules()
	_test_peek_next_kind()
	_test_straight_belt_movement()
	_test_following_pair_moves()
	_test_three_items_loop_moves()
	_test_full_loop_stalls_and_misses()
	_test_merge_low_id_wins()
	_test_head_on_swap_stays()
	_test_blocked_item_misses_after_five()
	_test_stuck_counter_resets_after_move()
	_test_matching_exit_scores()
	_test_wrong_exit_misses()
	_test_two_items_same_exit()
	_test_off_board_misses()
	_test_exit_departure_allows_following_move()
	_test_splitter_alternates()
	_test_splitters_are_independent()
	_test_splitter_toggle_waits_until_open()
	_test_splitter_toggles_on_exit_and_offboard()
	_test_splitter_relative_direction()
	_test_spawn_schedule()
	_test_blocked_spawn_consumes_rng_and_misses()
	_test_blocked_spawn_consumes_id()
	_test_finished_freezes_state()
	_test_deterministic_replay()
	_test_rng_sequence_matches_spec()
	_test_standard_map_win_path()

func _test_contract() -> bool:
	var detail_parts: Array[String] = []
	_board_script = load("res://scripts/board_model.gd")
	if _board_script == null:
		_record(false, "contract", "load / instantiate / API / enums", "load failed")
		return false
	var model: Variant = _new_model()
	if model == null:
		_record(false, "contract", "load / instantiate / API / enums", "instantiate failed")
		return false
	for method_name: String in CONTRACT_METHODS:
		if not model.has_method(method_name):
			detail_parts.append("missing method %s" % method_name)
	var constants: Dictionary = _board_script.get_script_constant_map()
	var cell_enum: Dictionary = constants.get("CellKind", {})
	var item_enum: Dictionary = constants.get("ItemKind", {})
	for index: int in range(CELL_NAMES.size()):
		var name: String = CELL_NAMES[index]
		if not cell_enum.has(name) or int(cell_enum.get(name, -999)) != index:
			detail_parts.append("CellKind.%s" % name)
		else:
			_cell[name] = index
	for index: int in range(ITEM_NAMES.size()):
		var name: String = ITEM_NAMES[index]
		if not item_enum.has(name) or int(item_enum.get(name, -999)) != index:
			detail_parts.append("ItemKind.%s" % name)
		else:
			_item[name] = index
	var passed: bool = detail_parts.is_empty()
	_record(passed, "contract", "load / instantiate / API / enums", "ok" if passed else ", ".join(detail_parts))
	return passed

func _fail_remaining_after_contract() -> void:
	var remaining: Array[Array] = [
		["api", "setup initial state"],
		["api", "acceptance spawn and early movement"],
		["api", "get_cell ASCII mapping and out of bounds"],
		["api", "place_belt rules"],
		["api", "rotate_cell rules"],
		["api", "spawn_item rules and RNG non-consumption"],
		["api", "peek_next_kind is stable and matches spawn"],
		["movement", "straight belts move one cell per tick"],
		["movement", "adjacent pair follows in the same tick"],
		["movement", "three items in loop all advance"],
		["movement", "full loop stalls then misses"],
		["collision", "merge to same empty cell chooses low id"],
		["collision", "head-on swap is blocked"],
		["collision", "blocked item misses after five ticks"],
		["collision", "stuck counter resets after movement"],
		["exit_scoring", "matching exit scores and removes item"],
		["exit_scoring", "wrong exit misses"],
		["exit_scoring", "two items can enter same exit"],
		["exit_scoring", "off-board movement misses"],
		["exit_scoring", "exit departure frees previous cell for follower"],
		["splitter", "splitter alternates right left right"],
		["splitter", "splitter toggles are independent"],
		["splitter", "blocked splitter does not toggle"],
		["splitter", "splitter toggles on exit and off-board departure"],
		["splitter", "splitter right is relative to entry direction"],
		["spawn_miss", "spawn schedule is t=1,4,7"],
		["spawn_miss", "blocked spawn misses and consumes RNG"],
		["spawn_miss", "blocked spawn consumes id"],
		["spawn_miss", "finish at t=120 freezes future ticks"],
		["determinism", "same seed and operations produce same results"],
		["determinism", "spawn color sequence matches RandomNumberGenerator"],
		["win_path", "standard map simple controller reaches win threshold"],
	]
	for entry: Array in remaining:
		_record(false, String(entry[0]), String(entry[1]), "contract failed")

func _test_setup_initial_state() -> void:
	var model: Variant = _setup(STANDARD_MAP, 12345)
	var passed: bool = _get_int(model, "get_tick") == 0 and _items(model).is_empty() and _get_int(model, "get_score") == 0 and _get_int(model, "get_misses") == 0 and not _get_bool(model, "is_finished")
	_record(passed, "api", "setup initial state", _state_detail(model))

func _test_acceptance_spawn_and_move() -> void:
	var model: Variant = _setup(STANDARD_MAP, 12345)
	var r1: Variant = model.call("step_tick")
	var items1: Array = _items(model)
	var first_ok: bool = _result_array(r1, "spawned") == [0] and _get_result_int(r1, "tick") == 1 and items1.size() == 1 and _item_pos(items1[0]) == Vector2i(0, 1) and _item_dir(items1[0]) == DIR_RIGHT
	var r2: Variant = model.call("step_tick")
	var items2: Array = _items(model)
	var second_ok: bool = _result_array(r2, "spawned").is_empty() and items2.size() == 1 and _item_pos(items2[0]) == Vector2i(1, 1)
	var r3: Variant = model.call("step_tick")
	var passed: bool = first_ok and second_ok and _result_array(r3, "spawned").is_empty()
	_record(passed, "api", "acceptance spawn and early movement", "t1=%s t2=%s t3_spawn=%s" % [str(_item_positions(items1)), str(_item_positions(items2)), str(_result_array(r3, "spawned"))])

func _test_get_cell_ascii_and_outside() -> void:
	var map: PackedStringArray = [" .^>v< S", "#RBI....", "........", "........", "........", "........", "........", "........"]
	var model: Variant = _setup(map, 1)
	var checks: Array[Array] = [
		[Vector2i(0, 0), "EMPTY"],
		[Vector2i(1, 0), "EMPTY"],
		[Vector2i(2, 0), "BELT_UP"],
		[Vector2i(3, 0), "BELT_RIGHT"],
		[Vector2i(4, 0), "BELT_DOWN"],
		[Vector2i(5, 0), "BELT_LEFT"],
		[Vector2i(6, 0), "EMPTY"],
		[Vector2i(7, 0), "SPLITTER"],
		[Vector2i(0, 1), "BLOCK"],
		[Vector2i(1, 1), "EXIT_RED"],
		[Vector2i(2, 1), "EXIT_BLUE"],
		[Vector2i(3, 1), "SPAWN"],
		[Vector2i(-1, 0), "EMPTY"],
		[Vector2i(8, 8), "EMPTY"],
	]
	var passed: bool = true
	for check: Array in checks:
		if int(model.call("get_cell", check[0])) != _cell[String(check[1])]:
			passed = false
			break
	_record(passed, "api", "get_cell ASCII mapping and out of bounds", "checked=%d" % checks.size())

func _test_place_belt_rules() -> void:
	var model: Variant = _setup(STANDARD_MAP, 1)
	var ok_empty: bool = bool(model.call("place_belt", Vector2i(0, 0), _cell["BELT_UP"])) and int(model.call("get_cell", Vector2i(0, 0))) == _cell["BELT_UP"]
	var reject_spawn: bool = not bool(model.call("place_belt", Vector2i(0, 1), _cell["BELT_UP"]))
	var reject_exit: bool = not bool(model.call("place_belt", Vector2i(7, 3), _cell["BELT_UP"]))
	var block_map: PackedStringArray = ["I#......", "........", "........", "........", "........", "........", "........", "........"]
	var blocked: Variant = _setup(block_map, 1)
	var reject_block: bool = not bool(blocked.call("place_belt", Vector2i(1, 0), _cell["BELT_UP"]))
	var reject_belt: bool = not bool(model.call("place_belt", Vector2i(1, 1), _cell["BELT_UP"]))
	var reject_splitter_kind: bool = not bool(model.call("place_belt", Vector2i(0, 2), _cell["SPLITTER"]))
	var reject_empty_kind: bool = not bool(model.call("place_belt", Vector2i(0, 2), _cell["EMPTY"]))
	_record(ok_empty and reject_spawn and reject_exit and reject_block and reject_belt and reject_splitter_kind and reject_empty_kind, "api", "place_belt rules", "cell00=%d" % int(model.call("get_cell", Vector2i(0, 0))))

func _test_rotate_cell_rules() -> void:
	var model: Variant = _setup(["I^>v<SRB", "........", "........", "........", "........", "........", "........", "........"], 1)
	var cycle_ok: bool = true
	var pos: Vector2i = Vector2i(1, 0)
	for expected_name: String in ["BELT_RIGHT", "BELT_DOWN", "BELT_LEFT", "BELT_UP"]:
		cycle_ok = cycle_ok and bool(model.call("rotate_cell", pos)) and int(model.call("get_cell", pos)) == _cell[expected_name]
	var reject_splitter: bool = not bool(model.call("rotate_cell", Vector2i(5, 0)))
	var reject_empty: bool = not bool(model.call("rotate_cell", Vector2i(0, 1)))
	var reject_exit: bool = not bool(model.call("rotate_cell", Vector2i(6, 0)))
	_record(cycle_ok and reject_splitter and reject_empty and reject_exit, "api", "rotate_cell rules", "cycle_ok=%s" % str(cycle_ok))

func _test_spawn_item_rules() -> void:
	var model: Variant = _setup(["I>......", "........", "........", "........", "........", "........", "........", "........"], 99)
	var before: int = int(model.call("peek_next_kind"))
	var id0: int = int(model.call("spawn_item", _item["RED"], Vector2i(1, 0), DIR_RIGHT))
	var after_success: int = int(model.call("peek_next_kind"))
	var invalid_empty: int = int(model.call("spawn_item", _item["RED"], Vector2i(0, 1), DIR_RIGHT))
	var invalid_occupied: int = int(model.call("spawn_item", _item["BLUE"], Vector2i(1, 0), DIR_RIGHT))
	var invalid_outside: int = int(model.call("spawn_item", _item["BLUE"], Vector2i(8, 0), DIR_RIGHT))
	var invalid_dir: int = int(model.call("spawn_item", _item["BLUE"], Vector2i(0, 0), Vector2i(1, 1)))
	var after_invalid: int = int(model.call("peek_next_kind"))
	var items: Array = _items(model)
	var passed: bool = id0 == 0 and items.size() == 1 and _item_id(items[0]) == 0 and _item_pos(items[0]) == Vector2i(1, 0) and invalid_empty == -1 and invalid_occupied == -1 and invalid_outside == -1 and invalid_dir == -1 and before == after_success and before == after_invalid
	_record(passed, "api", "spawn_item rules and RNG non-consumption", "ids=%s peek=%d/%d/%d" % [str([id0, invalid_empty, invalid_occupied, invalid_outside, invalid_dir]), before, after_success, after_invalid])

func _test_peek_next_kind() -> void:
	var model: Variant = _setup(STANDARD_MAP, 12345)
	var peek1: int = int(model.call("peek_next_kind"))
	var peek2: int = int(model.call("peek_next_kind"))
	var result: Variant = model.call("step_tick")
	var spawned_items: Array = _items(model)
	var spawned_kind: int = _item_kind(spawned_items[0]) if spawned_items.size() == 1 else -1
	_record(peek1 == peek2 and _result_array(result, "spawned") == [0] and peek1 == spawned_kind, "api", "peek_next_kind is stable and matches spawn", "peek=%d kind=%d" % [peek1, spawned_kind])

func _test_straight_belt_movement() -> void:
	var model: Variant = _setup(_rows([">>>>>..."]), 1)
	var id: int = int(model.call("spawn_item", _item["RED"], Vector2i(0, 0), DIR_RIGHT))
	var positions: Array[Vector2i] = []
	for i: int in range(3):
		model.call("step_tick")
		positions.append(_pos_by_id(model, id))
	_record(id == 0 and positions == [Vector2i(1, 0), Vector2i(2, 0), Vector2i(3, 0)], "movement", "straight belts move one cell per tick", str(positions))

func _test_following_pair_moves() -> void:
	var model: Variant = _setup(_rows([">>>>>..."]), 1)
	model.call("spawn_item", _item["RED"], Vector2i(1, 0), DIR_RIGHT)
	model.call("spawn_item", _item["BLUE"], Vector2i(0, 0), DIR_RIGHT)
	model.call("step_tick")
	_record(_positions_for_ids(model, [0, 1]) == [Vector2i(2, 0), Vector2i(1, 0)], "movement", "adjacent pair follows in the same tick", str(_positions_for_ids(model, [0, 1])))

func _test_three_items_loop_moves() -> void:
	var model: Variant = _setup(_rows([">v......", "^<......"]), 1)
	model.call("spawn_item", _item["RED"], Vector2i(0, 0), DIR_RIGHT)
	model.call("spawn_item", _item["BLUE"], Vector2i(1, 0), DIR_RIGHT)
	model.call("spawn_item", _item["RED"], Vector2i(1, 1), DIR_LEFT)
	model.call("step_tick")
	var expected: Array[Vector2i] = [Vector2i(1, 0), Vector2i(1, 1), Vector2i(0, 1)]
	_record(_positions_for_ids(model, [0, 1, 2]) == expected, "movement", "three items in loop all advance", str(_positions_for_ids(model, [0, 1, 2])))

func _test_full_loop_stalls_and_misses() -> void:
	var model: Variant = _setup(_rows([">v......", "^<......"]), 1)
	model.call("spawn_item", _item["RED"], Vector2i(0, 0), DIR_RIGHT)
	model.call("spawn_item", _item["BLUE"], Vector2i(1, 0), DIR_RIGHT)
	model.call("spawn_item", _item["RED"], Vector2i(1, 1), DIR_LEFT)
	model.call("spawn_item", _item["BLUE"], Vector2i(0, 1), DIR_UP)
	var last: Variant = null
	for i: int in range(STUCK_LIMIT):
		last = model.call("step_tick")
	var passed: bool = not _has_id(model, 0) and not _has_id(model, 1) and not _has_id(model, 2) and not _has_id(model, 3)
	for id: int in [0, 1, 2, 3]:
		passed = passed and _result_array(last, "missed").has(id)
	_record(passed, "movement", "full loop stalls then misses", "items=%d missed=%s" % [_items(model).size(), str(_result_array(last, "missed"))])

func _test_merge_low_id_wins() -> void:
	var model: Variant = _setup(_rows([">>......", ".^......"]), 1)
	model.call("spawn_item", _item["RED"], Vector2i(0, 0), DIR_RIGHT)
	model.call("spawn_item", _item["BLUE"], Vector2i(1, 1), DIR_UP)
	model.call("step_tick")
	var passed: bool = _positions_for_ids(model, [0, 1]) == [Vector2i(1, 0), Vector2i(1, 1)]
	_record(passed, "collision", "merge to same empty cell chooses low id", str(_positions_for_ids(model, [0, 1])))

func _test_head_on_swap_stays() -> void:
	var model: Variant = _setup(_rows([".><....."]), 1)
	model.call("spawn_item", _item["RED"], Vector2i(1, 0), DIR_RIGHT)
	model.call("spawn_item", _item["BLUE"], Vector2i(2, 0), DIR_LEFT)
	model.call("step_tick")
	_record(_positions_for_ids(model, [0, 1]) == [Vector2i(1, 0), Vector2i(2, 0)], "collision", "head-on swap is blocked", str(_positions_for_ids(model, [0, 1])))

func _test_blocked_item_misses_after_five() -> void:
	var model: Variant = _setup(_rows([".>#....."]), 1)
	model.call("spawn_item", _item["RED"], Vector2i(1, 0), DIR_RIGHT)
	var last: Variant = null
	for i: int in range(STUCK_LIMIT):
		last = model.call("step_tick")
	_record(not _has_id(model, 0) and _result_array(last, "missed").has(0) and _get_int(model, "get_misses") >= 1, "collision", "blocked item misses after five ticks", "missed=%s misses=%d" % [str(_result_array(last, "missed")), _get_int(model, "get_misses")])

func _test_stuck_counter_resets_after_move() -> void:
	var model: Variant = _setup(_rows([".>#.....", ".>#....."]), 1)
	model.call("spawn_item", _item["RED"], Vector2i(1, 0), DIR_RIGHT)
	for i: int in range(3):
		model.call("step_tick")
	model.call("rotate_cell", Vector2i(1, 0))
	model.call("step_tick")
	var after_move: Vector2i = _pos_by_id(model, 0)
	for i: int in range(4):
		model.call("step_tick")
	var passed: bool = _has_id(model, 0) and after_move == Vector2i(1, 1)
	_record(passed, "collision", "stuck counter resets after movement", "after_move=%s has_id=%s" % [str(after_move), str(_has_id(model, 0))])

func _test_matching_exit_scores() -> void:
	var model: Variant = _setup(_rows([".>R....."]), 1)
	model.call("spawn_item", _item["RED"], Vector2i(1, 0), DIR_RIGHT)
	var result: Variant = model.call("step_tick")
	_record(not _has_id(model, 0) and _get_int(model, "get_score") == 1 and _result_array(result, "delivered") == [0], "exit_scoring", "matching exit scores and removes item", "score=%d delivered=%s" % [_get_int(model, "get_score"), str(_result_array(result, "delivered"))])

func _test_wrong_exit_misses() -> void:
	var model: Variant = _setup(_rows([".>R....."]), 1)
	model.call("spawn_item", _item["BLUE"], Vector2i(1, 0), DIR_RIGHT)
	var result: Variant = model.call("step_tick")
	_record(not _has_id(model, 0) and _get_int(model, "get_misses") == 1 and _result_array(result, "missed") == [0], "exit_scoring", "wrong exit misses", "misses=%d missed=%s" % [_get_int(model, "get_misses"), str(_result_array(result, "missed"))])

func _test_two_items_same_exit() -> void:
	var model: Variant = _setup(_rows([".>R.....", "..^....."]), 1)
	model.call("spawn_item", _item["RED"], Vector2i(1, 0), DIR_RIGHT)
	model.call("spawn_item", _item["RED"], Vector2i(2, 1), DIR_UP)
	var result: Variant = model.call("step_tick")
	_record(not _has_id(model, 0) and not _has_id(model, 1) and _get_int(model, "get_score") == 2 and _result_array(result, "delivered") == [0, 1], "exit_scoring", "two items can enter same exit", "delivered=%s" % str(_result_array(result, "delivered")))

func _test_off_board_misses() -> void:
	var model: Variant = _setup(_rows(["<......."]), 1)
	model.call("spawn_item", _item["RED"], Vector2i(0, 0), DIR_LEFT)
	var result: Variant = model.call("step_tick")
	_record(not _has_id(model, 0) and _result_array(result, "missed").has(0), "exit_scoring", "off-board movement misses", "missed=%s" % str(_result_array(result, "missed")))

func _test_exit_departure_allows_following_move() -> void:
	var model: Variant = _setup(_rows([">>R....."]), 1)
	model.call("spawn_item", _item["RED"], Vector2i(1, 0), DIR_RIGHT)
	model.call("spawn_item", _item["BLUE"], Vector2i(0, 0), DIR_RIGHT)
	var result: Variant = model.call("step_tick")
	var passed: bool = not _has_id(model, 0) and _pos_by_id(model, 1) == Vector2i(1, 0) and _result_array(result, "delivered") == [0]
	_record(passed, "exit_scoring", "exit departure frees previous cell for follower", "items=%s delivered=%s" % [str(_positions_for_ids(model, [0, 1])), str(_result_array(result, "delivered"))])

func _test_splitter_alternates() -> void:
	var model: Variant = _setup(_rows(["........", "...B....", "...^....", "...S....", "...v....", "...B...."]), 1)
	var exits: Array[Vector2i] = []
	for i: int in range(3):
		var id: int = int(model.call("spawn_item", _item["BLUE"], Vector2i(3, 3), DIR_RIGHT))
		model.call("step_tick")
		exits.append(_pos_by_id(model, id))
		if _has_id(model, id):
			model.call("step_tick")
	var passed: bool = exits == [Vector2i(3, 4), Vector2i(3, 2), Vector2i(3, 4)]
	_record(passed, "splitter", "splitter alternates right left right", str(exits))

func _test_splitters_are_independent() -> void:
	var model: Variant = _setup(_rows(["........", "........", "........", "..S..S..", "..v..v..", "..B..B.."]), 1)
	var first_id: int = int(model.call("spawn_item", _item["BLUE"], Vector2i(2, 3), DIR_RIGHT))
	model.call("step_tick")
	if _has_id(model, first_id):
		model.call("step_tick")
	var second_id: int = int(model.call("spawn_item", _item["BLUE"], Vector2i(5, 3), DIR_RIGHT))
	model.call("step_tick")
	var pos_after_first_on_second: Vector2i = _pos_by_id(model, second_id)
	var passed: bool = pos_after_first_on_second == Vector2i(5, 4)
	_record(passed, "splitter", "splitter toggles are independent", "second_exit=%s" % str(pos_after_first_on_second))

func _test_splitter_toggle_waits_until_open() -> void:
	var model: Variant = _setup(_rows(["........", "........", "...^....", "...S....", "..<v#...", "........"]), 1)
	model.call("spawn_item", _item["RED"], Vector2i(3, 4), DIR_DOWN)
	model.call("spawn_item", _item["BLUE"], Vector2i(3, 3), DIR_RIGHT)
	for i: int in range(2):
		model.call("step_tick")
	model.call("rotate_cell", Vector2i(3, 4))
	model.call("step_tick")
	var first_exit: Vector2i = Vector2i(-9, -9)
	for snapshot: Variant in _items(model):
		if _item_id(snapshot) == 1:
			first_exit = _item_pos(snapshot)
	model.call("spawn_item", _item["BLUE"], Vector2i(3, 3), DIR_RIGHT)
	model.call("step_tick")
	var second_exit: Vector2i = Vector2i(-9, -9)
	for snapshot: Variant in _items(model):
		if _item_id(snapshot) == 3:
			second_exit = _item_pos(snapshot)
	var passed: bool = first_exit == Vector2i(3, 4) and second_exit == Vector2i(3, 2)
	_record(passed, "splitter", "blocked splitter does not toggle", "first=%s second=%s" % [str(first_exit), str(second_exit)])

func _test_splitter_toggles_on_exit_and_offboard() -> void:
	var exit_model: Variant = _setup(_rows(["........", "........", "...^....", "...S....", "...B...."]), 1)
	exit_model.call("spawn_item", _item["BLUE"], Vector2i(3, 3), DIR_RIGHT)
	exit_model.call("step_tick")
	var second_exit_id: int = int(exit_model.call("spawn_item", _item["BLUE"], Vector2i(3, 3), DIR_RIGHT))
	exit_model.call("step_tick")
	var exit_second_up: bool = _get_int(exit_model, "get_score") == 1 and _pos_by_id(exit_model, second_exit_id) == Vector2i(3, 2)
	var off_model: Variant = _setup(_rows(["........", "........", "........", "........", "........", "........", "...^....", "...S...."]), 1)
	off_model.call("spawn_item", _item["BLUE"], Vector2i(3, 7), DIR_RIGHT)
	off_model.call("step_tick")
	var off_second_id: int = int(off_model.call("spawn_item", _item["BLUE"], Vector2i(3, 7), DIR_RIGHT))
	off_model.call("step_tick")
	var off_second_down: bool = false
	for snapshot: Variant in _items(off_model):
		if _item_id(snapshot) == off_second_id and _item_pos(snapshot) == Vector2i(3, 6):
			off_second_down = true
	_record(exit_second_up and off_second_down, "splitter", "splitter toggles on exit and off-board departure", "exit_case=%s off_case=%s" % [str(exit_second_up), str(off_second_down)])

func _test_splitter_relative_direction() -> void:
	var model: Variant = _setup(_rows(["........", "........", "........", "...S>...", "........"]), 1)
	model.call("spawn_item", _item["RED"], Vector2i(3, 3), DIR_UP)
	model.call("step_tick")
	var pos: Vector2i = _pos_by_id(model, 0)
	_record(pos == Vector2i(4, 3), "splitter", "splitter right is relative to entry direction", str(pos))

func _test_spawn_schedule() -> void:
	var model: Variant = _setup(STANDARD_MAP, 1)
	var spawned_ticks: Array[int] = []
	for i: int in range(7):
		var result: Variant = model.call("step_tick")
		if not _result_array(result, "spawned").is_empty():
			spawned_ticks.append(_get_result_int(result, "tick"))
	_record(spawned_ticks == [1, 4, 7], "spawn_miss", "spawn schedule is t=1,4,7", str(spawned_ticks))

func _test_blocked_spawn_consumes_rng_and_misses() -> void:
	var model: Variant = _setup(["I#......", "........", "........", "........", "........", "........", "........", "........"], 54321)
	var expected: Array[int] = _expected_kinds(54321, 3)
	model.call("spawn_item", _item["RED"], Vector2i(0, 0), DIR_RIGHT)
	var r1: Variant = model.call("step_tick")
	var peek_after_blocked: int = int(model.call("peek_next_kind"))
	for i: int in range(5):
		model.call("step_tick")
	var r7: Variant = model.call("step_tick")
	var spawned_kind: int = -1
	for snapshot: Variant in _items(model):
		if _item_id(snapshot) == 3:
			spawned_kind = _item_kind(snapshot)
	var passed: bool = _result_array(r1, "missed").has(1) and _get_int(model, "get_misses") >= 1 and peek_after_blocked == expected[1] and _result_array(r7, "spawned").has(3) and spawned_kind == expected[2]
	_record(passed, "spawn_miss", "blocked spawn misses and consumes RNG", "expected=%s peek=%d r1=%s r7=%s kind=%d" % [str(expected), peek_after_blocked, str(_result_array(r1, "missed")), str(_result_array(r7, "spawned")), spawned_kind])

func _test_blocked_spawn_consumes_id() -> void:
	var model: Variant = _setup(["I#......", "........", "........", "........", "........", "........", "........", "........"], 11)
	model.call("spawn_item", _item["RED"], Vector2i(0, 0), DIR_RIGHT)
	for i: int in range(6):
		model.call("step_tick")
	var result: Variant = model.call("step_tick")
	_record(_result_array(result, "spawned").has(3), "spawn_miss", "blocked spawn consumes id", "spawned=%s" % str(_result_array(result, "spawned")))

func _test_finished_freezes_state() -> void:
	var model: Variant = _setup(STANDARD_MAP, 1)
	var r120: Variant = null
	for i: int in range(TOTAL_TICKS):
		r120 = model.call("step_tick")
	var tick_before: int = _get_int(model, "get_tick")
	var score_before: int = _get_int(model, "get_score")
	var misses_before: int = _get_int(model, "get_misses")
	var items_before: Array[Dictionary] = _snapshot_items(model)
	var r121: Variant = model.call("step_tick")
	var passed: bool = _get_result_bool(r120, "finished") and _get_result_bool(r121, "finished") and _get_result_int(r121, "tick") == tick_before and _get_int(model, "get_tick") == tick_before and _get_int(model, "get_score") == score_before and _get_int(model, "get_misses") == misses_before and _snapshot_items(model) == items_before and _result_array(r121, "spawned").is_empty()
	_record(passed, "spawn_miss", "finish at t=120 freezes future ticks", "tick=%d r121_tick=%d" % [tick_before, _get_result_int(r121, "tick")])

func _test_deterministic_replay() -> void:
	var first: Dictionary = _run_determinism_sequence(2468)
	var second: Dictionary = _run_determinism_sequence(2468)
	_record(first == second, "determinism", "same seed and operations produce same results", "events=%d" % int(first.get("events", []).size()))

func _test_rng_sequence_matches_spec() -> void:
	var seed: int = 97531
	var expected: Array[int] = _expected_kinds(seed, 6)
	var model: Variant = _setup(STANDARD_MAP, seed)
	var observed: Array[int] = []
	for i: int in range(6):
		observed.append(int(model.call("peek_next_kind")))
		var spawned_id: int = -1
		while spawned_id == -1 and not _get_bool(model, "is_finished"):
			var result: Variant = model.call("step_tick")
			if not _result_array(result, "spawned").is_empty():
				spawned_id = int(_result_array(result, "spawned")[0])
	_record(observed == expected, "determinism", "spawn color sequence matches RandomNumberGenerator", "expected=%s observed=%s" % [str(expected), str(observed)])

func _test_standard_map_win_path() -> void:
	var model: Variant = _setup(STANDARD_MAP, 12345)
	for i: int in range(TOTAL_TICKS):
		for snapshot: Variant in _items(model):
			if _item_pos(snapshot) == Vector2i(5, 3):
				if _item_kind(snapshot) == _item["RED"]:
					while int(model.call("get_cell", Vector2i(5, 3))) != _cell["BELT_RIGHT"]:
						model.call("rotate_cell", Vector2i(5, 3))
				else:
					while int(model.call("get_cell", Vector2i(5, 3))) != _cell["BELT_DOWN"]:
						model.call("rotate_cell", Vector2i(5, 3))
		model.call("step_tick")
	var passed: bool = _get_int(model, "get_score") >= 20 and _get_int(model, "get_misses") == 0
	_record(passed, "win_path", "standard map simple controller reaches win threshold", "score=%d misses=%d" % [_get_int(model, "get_score"), _get_int(model, "get_misses")])

func _new_model() -> Variant:
	if _board_script == null:
		return null
	return _board_script.new()

func _setup(map: PackedStringArray, seed: int) -> Variant:
	var model: Variant = _new_model()
	model.call("setup", map, seed)
	return model

func _rows(rows: Array[String]) -> PackedStringArray:
	var out: PackedStringArray = []
	var has_spawn: bool = false
	for y: int in range(HEIGHT):
		var row: String = rows[y] if y < rows.size() else "........"
		while row.length() < WIDTH:
			row += "."
		if row.length() > WIDTH:
			row = row.substr(0, WIDTH)
		if row.contains("I"):
			has_spawn = true
		out.append(row)
	if not has_spawn:
		out[HEIGHT - 1] = out[HEIGHT - 1].substr(0, WIDTH - 1) + "I"
	return out

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

func _print_grade() -> void:
	var payload: Dictionary = {"passed": _passed, "failed": _failed, "categories": _categories, "tests": _tests}
	print("GRADE_JSON: %s" % JSON.stringify(payload))

func _items(model: Variant) -> Array:
	var result: Variant = model.call("get_items")
	if result is Array:
		return result
	return []

func _snapshot_items(model: Variant) -> Array[Dictionary]:
	var out: Array[Dictionary] = []
	for snapshot: Variant in _items(model):
		out.append({"id": _item_id(snapshot), "kind": _item_kind(snapshot), "pos": _item_pos(snapshot), "dir": _item_dir(snapshot)})
	return out

func _item_id(snapshot: Variant) -> int:
	return int(snapshot.get("id"))

func _item_kind(snapshot: Variant) -> int:
	return int(snapshot.get("kind"))

func _item_pos(snapshot: Variant) -> Vector2i:
	return snapshot.get("pos")

func _item_dir(snapshot: Variant) -> Vector2i:
	return snapshot.get("dir")

func _item_positions(items: Array) -> Array[Vector2i]:
	var positions: Array[Vector2i] = []
	for snapshot: Variant in items:
		positions.append(_item_pos(snapshot))
	return positions

func _has_id(model: Variant, id: int) -> bool:
	for snapshot: Variant in _items(model):
		if _item_id(snapshot) == id:
			return true
	return false

func _pos_by_id(model: Variant, id: int) -> Vector2i:
	for snapshot: Variant in _items(model):
		if _item_id(snapshot) == id:
			return _item_pos(snapshot)
	return Vector2i(-999, -999)

func _positions_for_ids(model: Variant, ids: Array[int]) -> Array[Vector2i]:
	var positions: Array[Vector2i] = []
	for id: int in ids:
		positions.append(_pos_by_id(model, id))
	return positions

func _get_int(model: Variant, method_name: String) -> int:
	return int(model.call(method_name))

func _get_bool(model: Variant, method_name: String) -> bool:
	return bool(model.call(method_name))

func _get_result_int(result: Variant, property_name: String) -> int:
	return int(result.get(property_name))

func _get_result_bool(result: Variant, property_name: String) -> bool:
	return bool(result.get(property_name))

func _result_array(result: Variant, property_name: String) -> Array:
	var value: Variant = result.get(property_name)
	if value is Array:
		return value
	return []

func _state_detail(model: Variant) -> String:
	return "tick=%d items=%d score=%d misses=%d finished=%s" % [_get_int(model, "get_tick"), _items(model).size(), _get_int(model, "get_score"), _get_int(model, "get_misses"), str(_get_bool(model, "is_finished"))]

func _expected_kinds(seed: int, count: int) -> Array[int]:
	var rng: RandomNumberGenerator = RandomNumberGenerator.new()
	rng.seed = seed
	var values: Array[int] = []
	for i: int in range(count):
		values.append(_item["RED"] if int(rng.randi()) % 2 == 0 else _item["BLUE"])
	return values

func _run_determinism_sequence(seed: int) -> Dictionary:
	var model: Variant = _setup(STANDARD_MAP, seed)
	var events: Array[Dictionary] = []
	for tick: int in range(1, TOTAL_TICKS + 1):
		if tick == 3:
			model.call("place_belt", Vector2i(0, 0), _cell["BELT_RIGHT"])
		if tick == 12:
			model.call("rotate_cell", Vector2i(5, 3))
		if tick == 24:
			model.call("rotate_cell", Vector2i(5, 3))
		var result: Variant = model.call("step_tick")
		events.append({
			"tick": _get_result_int(result, "tick"),
			"spawned": _result_array(result, "spawned").duplicate(),
			"delivered": _result_array(result, "delivered").duplicate(),
			"missed": _result_array(result, "missed").duplicate(),
			"finished": _get_result_bool(result, "finished"),
		})
	return {"events": events, "score": _get_int(model, "get_score"), "misses": _get_int(model, "get_misses")}
