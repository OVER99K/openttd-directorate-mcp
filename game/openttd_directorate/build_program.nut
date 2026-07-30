function D4_CompileBuildProgram(plan) {
	if (!D4_IsTable(plan) || !D4_Has(plan, "source_site") || !D4_Has(plan, "destination_site")) return { ok = false, error = D4_Error("program_missing_sites", "") };
	local ops = [];
	local source_station = D4_StationRectOperation("source_station", plan.station_blueprint, GSStation.STATION_NEW);
	if (!source_station.ok) return source_station;
	ops.append(source_station.op);
	local destination_station = D4_StationRectOperation("destination_station", plan.destination_blueprint, source_station.op.destination_station);
	if (!destination_station.ok) return destination_station;
	ops.append(destination_station.op);

	local start = D4_BlueprintPortLocation(plan.station_blueprint, "throat_ne");
	if (start == null) start = D4_BlueprintPortLocation(plan.station_blueprint, "throat");
	local goal = D4_BlueprintPortLocation(plan.destination_blueprint, "throat_sw");
	if (goal == null) goal = D4_BlueprintPortLocation(plan.destination_blueprint, "throat");
	if (start == null || goal == null) return { ok = false, error = D4_Error("program_missing_throats", "") };

	local route = D4_BuildLegalCenterline(start, goal, plan.company_id, plan.policy);
	if (!route.ok) return route;
	local paired = { ok = true, return_lane = [] };
	local single_shuttle = D4_Has(plan.station_blueprint, "name") && plan.station_blueprint.name == "single_shuttle_1xN";
	if (!single_shuttle) {
		paired = D4_DeriveProgramLanes(route.path);
		if (!paired.ok) return paired;
	}
	if (!D4_AppendLaneOperations(ops, "outbound", route.path)) return { ok = false, error = D4_Error("program_invalid_outbound", "") };
	if (!single_shuttle && !D4_AppendLaneOperations(ops, "return", paired.return_lane)) return { ok = false, error = D4_Error("program_invalid_return", "") };

	local depot = D4_DepotOperation(route.path);
	if (depot.ok) {
		ops.append(depot.access_op);
		ops.append(depot.op);
	}

	local signal_type = GSRail.SIGNALTYPE_PBS;
	/* A one-train shuttle neither needs nor can preflight a signal before its
	 * track exists: GSTestMode commands do not persist earlier simulated rail
	 * operations. Multi-train templates retain explicit signal operations. */
	if (!single_shuttle && route.path.len() >= 5) {
		local p = route.path[2];
		local f = route.path[3];
		ops.append({ op_id = "signal.outbound.0", kind = "signal", tile = D4_ToTile(p), point = p, front = D4_ToTile(f), signal_type = signal_type });
	}
	if (!single_shuttle && paired.return_lane.len() >= 5) {
		local p2 = paired.return_lane[2];
		local f2 = paired.return_lane[3];
		ops.append({ op_id = "signal.return.0", kind = "signal", tile = D4_ToTile(p2), point = p2, front = D4_ToTile(f2), signal_type = signal_type });
	}

	local validation = D4_ValidateBuildProgram(ops);
	if (!validation.ok) return validation;
	return {
		ok = true,
		version = DIRECTORATE_M4_BUILD_PROGRAM_VERSION,
		fingerprint = D4_BoundedFingerprint({ source = start, goal = goal, count = ops.len(), path = route.path, ret = paired.return_lane }),
		ops = ops,
		path = route.path,
		return_lane = paired.return_lane,
	};
}

function D4_SelectBestSitePair(source_candidates, destination_candidates) {
	local best = null;
	local best_score = null;
	local source_limit = source_candidates.len() < DIRECTORATE_M4_MAX_SITES ? source_candidates.len() : DIRECTORATE_M4_MAX_SITES;
	local destination_limit = destination_candidates.len() < DIRECTORATE_M4_MAX_SITES ? destination_candidates.len() : DIRECTORATE_M4_MAX_SITES;
	for (local si = 0; si < source_limit; si++) {
		for (local di = 0; di < destination_limit; di++) {
			local source = source_candidates[si];
			local destination = destination_candidates[di];
			local source_throat = D4_BlueprintPortLocation(source.blueprint, "throat_ne");
			if (source_throat == null) source_throat = D4_BlueprintPortLocation(source.blueprint, "throat");
			local destination_throat = D4_BlueprintPortLocation(destination.blueprint, "throat_sw");
			if (destination_throat == null) destination_throat = D4_BlueprintPortLocation(destination.blueprint, "throat");
			if (source_throat == null || destination_throat == null) continue;
			local source_platform = D4_NearestBlueprintPortPoint(source.blueprint, "platform_body", source_throat);
			local destination_platform = D4_NearestBlueprintPortPoint(destination.blueprint, "platform_body", destination_throat);
			if (source_platform == null || destination_platform == null) continue;
			local source_out = D4_DirectionBetween(source_platform, source_throat);
			local destination_out = D4_DirectionBetween(destination_platform, destination_throat);
			local source_to_destination = D4_DominantDirection(source_throat, destination_throat);
			local destination_to_source = D4_DominantDirection(destination_throat, source_throat);
			if (source_out < 0 || destination_out < 0 || source_to_destination < 0 || destination_to_source < 0) continue;
			local distance = abs(destination_throat.x - source_throat.x) + abs(destination_throat.y - source_throat.y);
			local orientation_penalty = 0;
			if (source_out != source_to_destination) orientation_penalty += 100000;
			if (destination_out != destination_to_source) orientation_penalty += 100000;
			local score = orientation_penalty + distance * 100 - source.score - destination.score + si + di;
			if (best == null || score < best_score) {
				best = { source = source, destination = destination, score = score, source_index = si, destination_index = di };
				best_score = score;
			}
		}
	}
	return best;
}

function D4_NearestBlueprintPortPoint(blueprint, port_name, target) {
	if (!D4_Has(blueprint, "ports") || !(port_name in blueprint.ports) || blueprint.ports[port_name].len() == 0) return null;
	local points = blueprint.ports[port_name];
	local best = points[0];
	local best_distance = abs(best.x - target.x) + abs(best.y - target.y);
	for (local i = 1; i < points.len(); i++) {
		local distance = abs(points[i].x - target.x) + abs(points[i].y - target.y);
		if (distance < best_distance) { best = points[i]; best_distance = distance; }
	}
	return best;
}

function D4_DominantDirection(from, to) {
	local dx = to.x - from.x;
	local dy = to.y - from.y;
	if (dx == 0 && dy == 0) return -1;
	if (abs(dx) >= abs(dy)) return dx >= 0 ? DIR_NE : DIR_SW;
	return dy >= 0 ? DIR_SE : DIR_NW;
}

function D4_StationRectOperation(op_id, blueprint, destination_station) {
	if (!D4_IsTable(blueprint) || !blueprint.ok) return { ok = false, error = D4_Error("invalid_station_blueprint", op_id) };
	/* A station rectangle is derived from station tiles only.  Blueprint throat,
	 * depot and reserve tiles are deliberately not part of this command. */
	local station_tiles = [];
	foreach (item in blueprint.tiles) if (item.kind == "station") station_tiles.append(item.point);
	if (station_tiles.len() == 0) return { ok = false, error = D4_Error("station_tiles_missing", op_id) };
	local min_x = station_tiles[0].x, max_x = min_x, min_y = station_tiles[0].y, max_y = min_y;
	foreach (p in station_tiles) { if (p.x < min_x) min_x = p.x; if (p.x > max_x) max_x = p.x; if (p.y < min_y) min_y = p.y; if (p.y > max_y) max_y = p.y; }
	local width = max_x - min_x + 1, height = max_y - min_y + 1;
	if (width * height != station_tiles.len() || width < 1 || height < 1 || width > DIRECTORATE_M4_MAX_STATION_SPREAD || height > DIRECTORATE_M4_MAX_STATION_SPREAD) return { ok = false, error = D4_Error("invalid_station_footprint", op_id) };
	local origin = { x = min_x, y = min_y }, endp = { x = max_x, y = max_y };
	local direction = width >= height ? GSRail.RAILTRACK_NE_SW : GSRail.RAILTRACK_NW_SE;
	local num_platforms = direction == GSRail.RAILTRACK_NE_SW ? height : width;
	local platform_length = direction == GSRail.RAILTRACK_NE_SW ? width : height;
	return { ok = true, op = { op_id = op_id, kind = "station_rect", tile = D4_ToTile(origin), point = origin, end_tile = D4_ToTile(endp), end_point = endp, direction = direction, num_platforms = num_platforms, platform_length = platform_length, destination_station = destination_station } };
}

function D4_BuildLegalCenterline(start, goal, company_id, policy) {
	/* Bounded clean-room A* adapted from the accepted M2 planner. Every
	 * candidate primitive is tested by OpenTTD; no client-supplied path is
	 * accepted and no map mutation occurs. */
	local max_len = D4_ClampInt(D4_Has(policy, "path_limit") ? policy.path_limit : 160, 160, 8, 384);
	local expansion_limit = D4_ClampInt(D4_Has(policy, "route_expansion_limit") ? policy.route_expansion_limit : 768, 768, 32, 2048);
	local frontier_limit = D4_ClampInt(D4_Has(policy, "route_frontier_limit") ? policy.route_frontier_limit : 4096, 4096, 128, 8192);
	local initial_dir = abs(goal.x - start.x) >= abs(goal.y - start.y) ? (goal.x >= start.x ? DIR_NE : DIR_SW) : (goal.y >= start.y ? DIR_SE : DIR_NW);
	local initial_h = (abs(goal.x - start.x) + abs(goal.y - start.y)) * 10;
	local seed = { point = start, dir = initial_dir, g = 0, cost = initial_h, index = 0, parent_index = -1, steps = 0, turns = 0 };
	local frontier = [seed];
	local nodes = [seed];
	local visited = {};
	local expansions = 0;
	local rejected_bounds = 0;
	local rejected_primitive = 0;
	local rejected_rail = 0;
	local rejected_endpoint = 0;
	while (frontier.len() > 0 && expansions < expansion_limit) {
		local node = D4_ProgramPopBest(frontier);
		local key = D4_PointKey(node.point) + ":" + node.dir;
		if (key in visited) continue;
		visited[key] <- true;
		expansions++;
		if (node.point.x == goal.x && node.point.y == goal.y) return D4_ProgramReconstruct(nodes, node, max_len);
		if (node.steps >= max_len) continue;
		local dirs = D4_ProgramDirections(node.dir, node.point, goal);
		foreach (dir in dirs) {
			if (dir == D4_RotateDir(node.dir, 2)) continue;
			local next = D4_Offset(node.point, dir, 1);
			if (!D4_IsPointOnMap(next) || !GSMap.IsValidTile(D4_ToTile(next))) { rejected_bounds++; continue; }
			local nkey = D4_PointKey(next) + ":" + dir;
			if (nkey in visited) continue;
			local prev = node.parent_index >= 0 ? nodes[node.parent_index].point : D4_Offset(node.point, D4_RotateDir(dir, 2), 1);
			if (!D4_IsPointOnMap(prev) || !D4_IsLegalPrimitive(prev, node.point, next)) { rejected_primitive++; continue; }
			if (!D4_TestProgramRailPiece(prev, node.point, next, company_id)) { rejected_rail++; continue; }
			if (next.x == goal.x && next.y == goal.y) {
				local continuation = D4_Offset(next, dir, 1);
				if (!D4_IsPointOnMap(continuation) || !D4_TestProgramRailPiece(node.point, next, continuation, company_id)) { rejected_endpoint++; continue; }
			}
			if (nodes.len() >= frontier_limit) continue;
			local turn_cost = dir == node.dir ? 0 : 5;
			local heuristic = (abs(goal.x - next.x) + abs(goal.y - next.y)) * 10;
			/* Keep the accumulated path cost separate from the heuristic. Adding the
			 * heuristic to node.cost on every generation compounds it once per hop,
			 * turning A* into a strongly greedy search that exhausts its bounded
			 * frontier on otherwise trivial routes. */
			local child_g = node.g + 10 + turn_cost;
			local child = { point = next, dir = dir, g = child_g, cost = child_g + heuristic, index = nodes.len(), parent_index = node.index, steps = node.steps + 1, turns = node.turns + (turn_cost > 0 ? 1 : 0) };
			nodes.append(child);
			frontier.append(child);
		}
	}
	return { ok = false, error = D4_Error("route_not_found", start.x + "," + start.y + "->" + goal.x + "," + goal.y + ":e=" + expansions + ":n=" + nodes.len() + ":b=" + rejected_bounds + ":p=" + rejected_primitive + ":r=" + rejected_rail + ":z=" + rejected_endpoint) };
}

function D4_TestProgramRailPiece(prev, tile, next, company_id) {
	if (!D4_IsPointOnMap(prev) || !D4_IsPointOnMap(tile) || !D4_IsPointOnMap(next)) return false;
	local mode = GSCompanyMode(company_id);
	if (!GSCompanyMode.IsValid() || !D4_SelectRailType()) return false;
	local tm = GSTestMode();
	return GSRail.BuildRail(D4_ToTile(prev), D4_ToTile(tile), D4_ToTile(next));
}

function D4_ProgramDirections(current, point, goal) {
	local raw = [];
	if (goal.x >= point.x) raw.append(DIR_NE); else raw.append(DIR_SW);
	if (goal.y >= point.y) raw.append(DIR_SE); else raw.append(DIR_NW);
	raw.append(current);
	raw.append(D4_LeftDir(current));
	raw.append(D4_RightDir(current));
	local dirs = [];
	foreach (dir in raw) {
		local duplicate = false;
		foreach (seen in dirs) if (seen == dir) duplicate = true;
		if (!duplicate) dirs.append(dir);
	}
	return dirs;
}

function D4_ProgramPopBest(frontier) {
	local best = 0;
	for (local i = 1; i < frontier.len(); i++) {
		local a = frontier[i], b = frontier[best];
		if (a.cost < b.cost || (a.cost == b.cost && (a.point.x < b.point.x || (a.point.x == b.point.x && (a.point.y < b.point.y || (a.point.y == b.point.y && a.dir < b.dir)))))) best = i;
	}
	local value = frontier[best];
	frontier.remove(best);
	return value;
}

function D4_ProgramReconstruct(nodes, node, max_len) {
	local rev = [];
	local cursor = node.index;
	local guard = 0;
	while (cursor >= 0 && cursor < nodes.len() && guard <= max_len) {
		rev.append(nodes[cursor].point);
		cursor = nodes[cursor].parent_index;
		guard++;
	}
	local path = [];
	for (local i = rev.len() - 1; i >= 0; i--) path.append(rev[i]);
	if (path.len() < 2) return { ok = false, error = D4_Error("route_reconstruct_failed", "") };
	return { ok = true, path = path };
}

function D4_ProgramLaneAppend(lane, point) {
	if (lane.len() > 0 && D4_PointKey(lane[lane.len() - 1]) == D4_PointKey(point)) return;
	lane.append(point);
}

function D4_DeriveProgramLanes(path) {
	/* Adapted from accepted M2's mitered corridor construction.  A simple
	 * perpendicular offset breaks at corners; the miter inserts the turn cells
	 * needed for a real adjacent rail path. */
	if (!D4_IsArray(path) || path.len() < 2) return { ok = false, error = D4_Error("invalid_centerline", "") };
	local lane = [];
	for (local i = 0; i < path.len(); i++) {
		local incoming = i == 0 ? D4_DirectionBetween(path[0], path[1]) : D4_DirectionBetween(path[i - 1], path[i]);
		local outgoing = i + 1 == path.len() ? incoming : D4_DirectionBetween(path[i], path[i + 1]);
		if (incoming < 0 || outgoing < 0 || outgoing == D4_RotateDir(incoming, 2)) return { ok = false, error = D4_Error("invalid_centerline_turn", i.tostring()) };
		if (incoming == outgoing) {
			D4_ProgramLaneAppend(lane, D4_Offset(path[i], D4_RightDir(incoming), 1));
		} else {
			local inside = outgoing == D4_RightDir(incoming);
			if (!inside) D4_ProgramLaneAppend(lane, D4_Offset(path[i], D4_RightDir(incoming), 1));
			D4_ProgramLaneAppend(lane, D4_Offset(D4_Offset(path[i], D4_RightDir(incoming), 1), D4_RightDir(outgoing), 1));
			if (!inside) D4_ProgramLaneAppend(lane, D4_Offset(path[i], D4_RightDir(outgoing), 1));
		}
	}
	local seen = {};
	foreach (p0 in path) seen[D4_PointKey(p0)] <- true;
	for (local j = 0; j < lane.len(); j++) {
		if (!D4_IsPointOnMap(lane[j])) return { ok = false, error = D4_Error("return_lane_out_of_map", j.tostring()) };
		if (D4_PointKey(lane[j]) in seen) return { ok = false, error = D4_Error("return_lane_overlap", j.tostring()) };
		if (j > 0 && !D4_IsAdjacent(lane[j - 1], lane[j])) return { ok = false, error = D4_Error("return_lane_non_adjacent", j.tostring()) };
	}
	local reverse = [];
	for (local k = lane.len() - 1; k >= 0; k--) reverse.append(lane[k]);
	return { ok = true, return_lane = reverse };
}

function D4_AppendLaneOperations(ops, prefix, path) {
	if (!D4_IsArray(path) || path.len() < 2) return false;
	for (local i = 0; i < path.len(); i++) {
		local prev = i > 0 ? path[i - 1] : D4_Offset(path[i], D4_RotateDir(D4_DirectionBetween(path[i], path[i + 1]), 2), 1);
		local next = i + 1 < path.len() ? path[i + 1] : D4_Offset(path[i], D4_DirectionBetween(path[i - 1], path[i]), 1);
		if (!D4_IsPointOnMap(prev) || !D4_IsPointOnMap(next) || !D4_IsLegalPrimitive(prev, path[i], next)) return false;
		ops.append({ op_id = "rail." + prefix + "." + i, kind = "rail_connection", tile = D4_ToTile(path[i]), point = path[i], prev = D4_ToTile(prev), prev_point = prev, next = D4_ToTile(next), next_point = next });
	}
	return true;
}

function D4_DepotOperation(path) {
	if (!D4_IsArray(path) || path.len() < 4) return { ok = false };
	local a = path[1];
	local b = path[2];
	local dir = D4_DirectionBetween(a, b);
	if (dir < 0) return { ok = false };
	local front = b;
	local depot_point = D4_Offset(front, D4_RightDir(dir), 1);
	if (!D4_IsPointOnMap(depot_point)) return { ok = false };
	local access_op = { op_id = "rail.depot_access.0", kind = "rail_connection", tile = D4_ToTile(front), point = front, prev = D4_ToTile(a), prev_point = a, next = D4_ToTile(depot_point), next_point = depot_point };
	return { ok = true, access_op = access_op, op = { op_id = "depot.0", kind = "depot", tile = D4_ToTile(depot_point), point = depot_point, front = D4_ToTile(front), front_point = front } };
}

function D4_ValidateBuildProgram(ops) {
	if (!D4_IsArray(ops) || ops.len() < 1 || ops.len() > DIRECTORATE_M4_MAX_OPERATION_ENTRIES) return { ok = false, error = D4_Error("invalid_program_size", "") };
	local station_count = 0;
	local seen = {};
	foreach (op in ops) {
		if (!D4_IsTable(op) || !D4_Has(op, "kind") || !D4_Has(op, "tile") || typeof op.tile != "integer" || !GSMap.IsValidTile(op.tile)) return { ok = false, error = D4_Error("invalid_program_operation", "") };
		if (op.kind == "station_rect") station_count++;
		else if (op.kind == "rail_connection") {
			if (!GSMap.IsValidTile(op.prev) || !GSMap.IsValidTile(op.next)) return { ok = false, error = D4_Error("invalid_rail_connection", op.op_id) };
		} else if (op.kind == "depot") {
			if (!GSMap.IsValidTile(op.front) || op.front == op.tile) return { ok = false, error = D4_Error("invalid_depot_front", op.op_id) };
		} else if (op.kind == "signal") {
			if (!GSMap.IsValidTile(op.front)) return { ok = false, error = D4_Error("invalid_signal_front", op.op_id) };
		} else return { ok = false, error = D4_Error("unknown_program_operation", op.kind) };
		local key = op.kind == "station_rect" ? "station:" + op.tile : op.kind + ":" + op.tile;
		if (key in seen && op.kind != "rail_connection") return { ok = false, error = D4_Error("program_overlap", key) };
		seen[key] <- true;
	}
	if (station_count != 2) return { ok = false, error = D4_Error("program_station_count", station_count.tostring()) };
	return { ok = true };
}

function D4_PreflightBuildProgram(program, company_id, reserve) {
	local cost = 0;
	local mode = GSCompanyMode(company_id);
	if (!GSCompanyMode.IsValid()) return { ok = false, error = D4_Error("invalid_company", company_id.tostring()) };
	if (!D4_SelectRailType()) return { ok = false, error = D4_Error("rail_type_unavailable", company_id.tostring()) };
	local tm = GSTestMode();
	foreach (op in program.ops) {
		local result = D4_ExecuteProgramOperation(op, company_id, true);
		if (!result.ok) return { ok = false, error = D4_Error("preflight_failed", op.op_id), failed_op = op.op_id, failure = result.failure, cost = cost, mutation = false };
		cost += result.cost;
		if (!D4_CanAfford(company_id, reserve, cost)) return { ok = false, error = D4_Error("insufficient_funds", op.op_id), failed_op = op.op_id, cost = cost, reserve = reserve, mutation = false };
	}
	return { ok = true, cost = cost, reserve = reserve, mutation = false };
}

function D4_ExecuteProgramOperation(op, company_id, test_only) {
	if (op.kind == "station_rect") {
		if (GSRail.IsRailStationTile(op.tile) && GSTile.GetOwner(op.tile) == company_id) return { ok = true, reused = true, cost = 0, detail = D4_ReadbackProgramOperation(op, company_id, "station") };
		if (!GSRail.BuildRailStation(op.tile, op.direction, op.num_platforms, op.platform_length, op.destination_station)) return { ok = false, failure = { reason = "station_build_failed", op_id = op.op_id, tile = op.tile } };
		return { ok = true, reused = false, cost = GSRail.GetBuildCost(GSRail.GetCurrentRailType(), GSRail.BT_STATION), detail = D4_ReadbackProgramOperation(op, company_id, "station") };
	}
	if (op.kind == "rail_connection") {
		if (GSRail.AreTilesConnected(op.prev, op.tile, op.next) && GSTile.GetOwner(op.tile) == company_id) return { ok = true, reused = true, cost = 0, detail = D4_ReadbackProgramOperation(op, company_id, "rail") };
		if (!GSRail.BuildRail(op.prev, op.tile, op.next)) return { ok = false, failure = { reason = "rail_build_failed", op_id = op.op_id, tile = op.tile, prev = op.prev, next = op.next } };
		if (!test_only && !GSRail.AreTilesConnected(op.prev, op.tile, op.next)) return { ok = false, failure = { reason = "rail_readback_failed", op_id = op.op_id, tile = op.tile } };
		return { ok = true, reused = false, cost = GSRail.GetBuildCost(GSRail.GetCurrentRailType(), GSRail.BT_TRACK), detail = D4_ReadbackProgramOperation(op, company_id, "rail") };
	}
	if (op.kind == "depot") {
		if (GSRail.IsRailDepotTile(op.tile) && GSTile.GetOwner(op.tile) == company_id && GSRail.GetRailDepotFrontTile(op.tile) == op.front) return { ok = true, reused = true, cost = 0, detail = D4_ReadbackProgramOperation(op, company_id, "depot") };
		if (!GSRail.BuildRailDepot(op.tile, op.front)) return { ok = false, failure = { reason = "depot_build_failed", op_id = op.op_id, tile = op.tile, front = op.front } };
		if (!test_only && (!GSRail.IsRailDepotTile(op.tile) || GSRail.GetRailDepotFrontTile(op.tile) != op.front)) return { ok = false, failure = { reason = "depot_readback_failed", op_id = op.op_id, tile = op.tile } };
		return { ok = true, reused = false, cost = GSRail.GetBuildCost(GSRail.GetCurrentRailType(), GSRail.BT_DEPOT), detail = D4_ReadbackProgramOperation(op, company_id, "depot") };
	}
	if (op.kind == "signal") {
		if (GSRail.GetSignalType(op.tile, op.front) == op.signal_type) return { ok = true, reused = true, cost = 0, detail = D4_ReadbackProgramOperation(op, company_id, "signal") };
		if (!GSRail.BuildSignal(op.tile, op.front, op.signal_type)) return { ok = false, failure = { reason = "signal_build_failed", op_id = op.op_id, tile = op.tile, front = op.front } };
		if (!test_only && GSRail.GetSignalType(op.tile, op.front) != op.signal_type) return { ok = false, failure = { reason = "signal_readback_failed", op_id = op.op_id, tile = op.tile } };
		return { ok = true, reused = false, cost = GSRail.GetBuildCost(GSRail.GetCurrentRailType(), GSRail.BT_SIGNAL), detail = D4_ReadbackProgramOperation(op, company_id, "signal") };
	}
	return { ok = false, failure = { reason = "unknown_program_operation", kind = op.kind } };
}

function D4_ReadbackProgramOperation(op, company_id, rollback_kind) {
	local detail = { kind = rollback_kind, op_id = op.op_id };
	if (op.kind == "station_rect") {
		detail.station_end <- op.end_tile;
		detail.direction <- op.direction;
		detail.num_platforms <- op.num_platforms;
		detail.platform_length <- op.platform_length;
	}
	if (op.kind == "rail_connection") {
		detail.prev <- op.prev;
		detail.next <- op.next;
	}
	if (op.kind == "depot") detail.front <- op.front;
	if (op.kind == "signal") {
		detail.front <- op.front;
		detail.signal_type <- op.signal_type;
	}
	return detail;
}

function D4_VerifyProgramTopology(program, company_id) {
	local failures = [];
	local stations = [];
	local rails = [];
	foreach (op in program.ops) {
		if (op.kind == "station_rect") {
			stations.append(op);
			if (!GSRail.IsRailStationTile(op.tile) || GSTile.GetOwner(op.tile) != company_id) failures.append({ op_id = op.op_id, reason = "station_missing", tile = op.tile });
		} else if (op.kind == "rail_connection") {
			rails.append(op);
			if (!GSRail.AreTilesConnected(op.prev, op.tile, op.next)) failures.append({ op_id = op.op_id, reason = "rail_disconnected", tile = op.tile, prev = op.prev, next = op.next });
		} else if (op.kind == "depot" && (!GSRail.IsRailDepotTile(op.tile) || GSRail.GetRailDepotFrontTile(op.tile) != op.front)) failures.append({ op_id = op.op_id, reason = "depot_mismatch", tile = op.tile, front = op.front });
		else if (op.kind == "signal" && GSRail.GetSignalType(op.tile, op.front) != op.signal_type) failures.append({ op_id = op.op_id, reason = "signal_mismatch", tile = op.tile, front = op.front });
	}

	/* A route is not topologically complete merely because its stations and
	 * internal rail primitives exist. Prove each station endpoint participates
	 * in an engine-confirmed rail primitive at the throat. */
	local station_connections = [];
	foreach (station in stations) {
		local connected = false;
		local rail_op_id = null;
		foreach (rail in rails) {
			if (rail.prev == station.tile && GSRail.AreTilesConnected(station.tile, rail.tile, rail.next)) {
				connected = true;
				rail_op_id = rail.op_id;
				break;
			}
			if (rail.next == station.tile && GSRail.AreTilesConnected(rail.prev, rail.tile, station.tile)) {
				connected = true;
				rail_op_id = rail.op_id;
				break;
			}
		}
		station_connections.append({ station_op_id = station.op_id, station_tile = station.tile, rail_op_id = rail_op_id, connected = connected });
		if (!connected) failures.append({ op_id = station.op_id, reason = "station_not_connected", tile = station.tile });
	}
	return { ok = failures.len() == 0, failures = failures, station_connections = station_connections };
}
