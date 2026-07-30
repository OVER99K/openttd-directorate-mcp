/* Clean-room route planner adapted from this repository's accepted M2 planner. */
function D4_ValidatePlanIntent(intent) {
	if (!D4_IsTable(intent)) return { ok = false, error = D4_Error("invalid_intent", "intent must be table") };
	local keys = ["origin_x", "origin_y", "destination_x", "destination_y"];
	for (local i = 0; i < keys.len(); i++) {
		local key = keys[i];
		if (!(key in intent) || typeof intent[key] != "integer") return { ok = false, error = D4_Error("invalid_intent_coordinates", key) };
	}
	local start = D4_Point(intent.origin_x, intent.origin_y);
	local goal = D4_Point(intent.destination_x, intent.destination_y);
	if (!D4_IsPointOnMap(start) || !D4_IsPointOnMap(goal)) return { ok = false, error = D4_Error("coordinates_out_of_map", "") };
	return { ok = true, start = start, goal = goal };
}

function D4_NewRoutePlan(id, company_id, intent, policy, fingerprint) {
	local expansion_limit = D4_ClampInt(GSController.GetSetting("expansion_limit"), 96, 8, 512);
	local frontier_limit = D4_ClampInt(GSController.GetSetting("frontier_limit"), 512, 32, 4096);
	local path_limit = D4_ClampInt(GSController.GetSetting("path_limit"), 256, 8, 1024);
	if (D4_IsTable(policy)) {
		if ("expansion_limit" in policy) expansion_limit = D4_ClampInt(policy.expansion_limit, expansion_limit, 1, expansion_limit);
		if ("frontier_limit" in policy) frontier_limit = D4_ClampInt(policy.frontier_limit, frontier_limit, 8, frontier_limit);
		if ("path_limit" in policy) path_limit = D4_ClampInt(policy.path_limit, path_limit, 4, path_limit);
	}
	local start = D4_Point(intent.origin_x, intent.origin_y);
	local goal = D4_Point(intent.destination_x, intent.destination_y);
	local normalized = D4_NormalizeEndpoints(start, goal);
	start = normalized.start;
	goal = normalized.goal;
	local dir = DIR_NE;
	if (abs(goal.y - start.y) > abs(goal.x - start.x)) dir = goal.y >= start.y ? DIR_SE : DIR_NW;
	local initial_h = (abs(goal.x - start.x) + abs(goal.y - start.y)) * 10;
	local seed = { point = start, dir = dir, g = 0, cost = initial_h, index = 0, parent_index = -1, steps = 0, turns = 0 };
	return {
		plan_id = id,
		revision = 0,
		company_id = company_id,
		state = "planning",
		policy = policy,
		intent = intent,
		created_tick = D4_Tick(),
		updated_tick = D4_Tick(),
		precondition_fingerprint = fingerprint,
		search_cursor = 0,
		candidates = [],
		phase = "search",
		bounds = { expansion_limit = expansion_limit, frontier_limit = frontier_limit, path_limit = path_limit },
		start = start,
		goal = goal,
		swapped = normalized.swapped,
		frontier = [seed],
		nodes = [seed],
		visited = {},
		visited_count = 0,
		expansions = 0,
		path = [],
		geometry = null,
	};
}

function D4_RoutePlannerStep(plan, limit) {
	if (plan.state != "planning") return;
	local expanded = 0;
	while (expanded < limit && plan.frontier.len() > 0) {
		local node = D4_PopBest(plan.frontier);
		local key = D4_PointKey(node.point) + ":" + node.dir;
		if (key in plan.visited) continue;
		plan.visited[key] <- true;
		plan.visited_count++;
		plan.expansions++;
		expanded++;
		if (node.point.x == plan.goal.x && node.point.y == plan.goal.y) {
			D4_CompleteRoutePlan(plan, node);
			return;
		}
		if (node.steps >= plan.bounds.path_limit) continue;
		for (local i = 0; i < 4; i++) {
			local dir = D4_NextDir(node.dir, plan.goal, node.point, i);
			if (dir == D4_RotateDir(node.dir, 2)) continue;
			local next = D4_Offset(node.point, dir, 1);
			if (!D4_IsPointOnMap(next)) continue;
			if (!GSMap.IsValidTile(D4_ToTile(next))) continue;
			local nkey = D4_PointKey(next) + ":" + dir;
			if (nkey in plan.visited) continue;
			local prev = D4_PreviousPoint(plan, node);
			if (prev != null && !D4_IsLegalPrimitive(prev, node.point, next)) continue;
			if (!D4_TestRailPiece(prev, node.point, next, plan.company_id)) continue;
			if (next.x == plan.goal.x && next.y == plan.goal.y && !D4_TestRailEndpoint(node.point, next, plan.company_id)) continue;
			local turn_cost = dir == node.dir ? 0 : 5;
			local h = (abs(plan.goal.x - next.x) + abs(plan.goal.y - next.y)) * 10;
			if (plan.nodes.len() >= plan.bounds.frontier_limit) continue;
			local child_g = node.g + 10 + turn_cost;
			local child = { point = next, dir = dir, g = child_g, cost = child_g + h, index = plan.nodes.len(), parent_index = node.index, steps = node.steps + 1, turns = node.turns + (turn_cost > 0 ? 1 : 0) };
			plan.nodes.append(child);
			plan.frontier.append(child);
		}
	}
	plan.updated_tick = D4_Tick();
	plan.revision++;
	plan.search_cursor = plan.expansions;
	if (plan.frontier.len() == 0) {
		plan.state = "failed";
		plan.phase = "exhausted";
	}
}

function D4_NextDir(current, goal, point, ordinal) {
	local dirs = [];
	if (goal.x >= point.x) dirs.append(DIR_NE); else dirs.append(DIR_SW);
	if (goal.y >= point.y) dirs.append(DIR_SE); else dirs.append(DIR_NW);
	dirs.append(current);
	dirs.append(D4_LeftDir(current));
	dirs.append(D4_RightDir(current));
	for (local i = 0; i < dirs.len(); i++) {
		local seen = false;
		for (local j = 0; j < i; j++) if (dirs[i] == dirs[j]) seen = true;
		if (!seen && ordinal == 0) return dirs[i];
		if (!seen) ordinal--;
	}
	return ordinal % 2 == 0 ? D4_RotateDir(current, 0) : D4_RotateDir(current, 2);
}

function D4_TestRailPiece(prev, tile, next, company_id) {
	if (!D4_IsPointOnMap(tile) || !D4_IsPointOnMap(next)) return false;
	if (!GSMap.IsValidTile(D4_ToTile(tile)) || !GSMap.IsValidTile(D4_ToTile(next))) return false;
	if (prev == null) {
		local first_dir = D4_DirectionBetween(tile, next);
		if (first_dir < 0) return false;
		prev = D4_Offset(tile, D4_RotateDir(first_dir, 2), 1);
	}
	if (!D4_IsPointOnMap(prev) || !GSMap.IsValidTile(D4_ToTile(prev))) return false;
	local mode = GSCompanyMode(company_id);
	if (!GSCompanyMode.IsValid()) return false;
	if (!D4_SelectRailType()) return false;
	local tm = GSTestMode();
	return GSRail.BuildRail(D4_ToTile(prev), D4_ToTile(tile), D4_ToTile(next));
}

function D4_TestRailEndpoint(prev, tile, company_id) {
	local direction = D4_DirectionBetween(prev, tile);
	if (direction < 0) return false;
	local continuation = D4_Offset(tile, direction, 1);
	if (!D4_IsPointOnMap(continuation)) return false;
	return D4_TestRailPiece(prev, tile, continuation, company_id);
}

function D4_PreviousPoint(plan, node) {
	if (node.parent_index < 0 || node.parent_index >= plan.nodes.len()) return null;
	return plan.nodes[node.parent_index].point;
}

function D4_PopBest(frontier) {
	local best = 0;
	for (local i = 1; i < frontier.len(); i++) {
		if (D4_NodeCompare(frontier[i], frontier[best]) < 0) best = i;
	}
	local value = frontier[best];
	frontier.remove(best);
	return value;
}

function D4_NodeCompare(a, b) {
	if (a.cost != b.cost) return a.cost < b.cost ? -1 : 1;
	if (a.point.x != b.point.x) return a.point.x < b.point.x ? -1 : 1;
	if (a.point.y != b.point.y) return a.point.y < b.point.y ? -1 : 1;
	if (a.dir != b.dir) return a.dir < b.dir ? -1 : 1;
	return 0;
}

function D4_CompleteRoutePlan(plan, node) {
	local rev = [];
	local cursor = node.index;
	local guard = 0;
	while (cursor >= 0 && cursor < plan.nodes.len() && guard < plan.bounds.path_limit) {
		rev.append(plan.nodes[cursor].point);
		cursor = plan.nodes[cursor].parent_index;
		guard++;
	}
	local path = [];
	for (local i = rev.len() - 1; i >= 0; i--) path.append(rev[i]);
	if (plan.swapped) {
		local oriented = [];
		for (local i = path.len() - 1; i >= 0; i--) oriented.append(path[i]);
		path = oriented;
	}
	if (D4_IsStaircase(path)) {
		plan.state = "failed";
		plan.phase = "staircase_rejected";
	} else {
		plan.path = path;
		plan.geometry = D4_DeriveCorridor(path, 1, "right");
		plan.candidates.append({ cost = node.cost, length = path.len(), geometry_ok = plan.geometry.ok });
		plan.state = plan.geometry.ok ? "completed" : "failed";
		plan.phase = plan.geometry.ok ? "completed_geometry" : "corridor_conflict";
	}
	plan.updated_tick = D4_Tick();
	plan.revision++;
	plan.search_cursor = plan.expansions;
}