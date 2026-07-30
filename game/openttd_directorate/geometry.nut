DIR_NE <- 0;
DIR_SE <- 1;
DIR_SW <- 2;
DIR_NW <- 3;

function D4_DirName(dir) {
	local names = ["NE", "SE", "SW", "NW"];
	return names[dir % 4];
}

function D4_RotateDir(dir, turns) {
	local v = (dir + turns) % 4;
	if (v < 0) v += 4;
	return v;
}

function D4_RightDir(dir) {
	return D4_RotateDir(dir, 1);
}

function D4_LeftDir(dir) {
	return D4_RotateDir(dir, 3);
}

function D4_DirDx(dir) {
	if (dir == DIR_NE) return 1;
	if (dir == DIR_SW) return -1;
	return 0;
}

function D4_DirDy(dir) {
	if (dir == DIR_SE) return 1;
	if (dir == DIR_NW) return -1;
	return 0;
}

function D4_Point(x, y) {
	return { x = x, y = y };
}

function D4_PointKey(p) {
	return p.x + "," + p.y;
}

function D4_Offset(p, dir, count) {
	return { x = p.x + D4_DirDx(dir) * count, y = p.y + D4_DirDy(dir) * count };
}

function D4_ForwardRight(p, dir, forward, right) {
	return D4_Offset(D4_Offset(p, dir, forward), D4_RightDir(dir), right);
}

function D4_IsAdjacent(a, b) {
	return abs(a.x - b.x) + abs(a.y - b.y) == 1;
}

function D4_DirectionBetween(a, b) {
	local dx = b.x - a.x;
	local dy = b.y - a.y;
	if (dx == 1 && dy == 0) return DIR_NE;
	if (dx == 0 && dy == 1) return DIR_SE;
	if (dx == -1 && dy == 0) return DIR_SW;
	if (dx == 0 && dy == -1) return DIR_NW;
	return -1;
}

function D4_NormalizeEndpoints(a, b) {
	if (a.x < b.x) return { start = a, goal = b, swapped = false };
	if (a.x > b.x) return { start = b, goal = a, swapped = true };
	if (a.y <= b.y) return { start = a, goal = b, swapped = false };
	return { start = b, goal = a, swapped = true };
}

function D4_TieBreakKey(p, dir, cost) {
	return cost + ":" + p.x + ":" + p.y + ":" + dir;
}

function D4_IsStraightMove(prev, tile, next) {
	return D4_IsAdjacent(prev, tile) && D4_IsAdjacent(tile, next) && D4_DirectionBetween(prev, tile) == D4_DirectionBetween(tile, next);
}

function D4_IsDiagonalPrimitive(prev, tile, next) {
	if (!D4_IsAdjacent(prev, tile) || !D4_IsAdjacent(tile, next)) return false;
	local a = D4_DirectionBetween(prev, tile);
	local b = D4_DirectionBetween(tile, next);
	return a >= 0 && b >= 0 && b != a && b != D4_RotateDir(a, 2);
}

function D4_IsLegalPrimitive(prev, tile, next) {
	return D4_IsStraightMove(prev, tile, next) || D4_IsDiagonalPrimitive(prev, tile, next);
}

function D4_IsNinetyTurn(a, b, c) {
	if (!D4_IsAdjacent(a, b) || !D4_IsAdjacent(b, c)) return true;
	local d1 = D4_DirectionBetween(a, b);
	local d2 = D4_DirectionBetween(b, c);
	return d1 >= 0 && d2 >= 0 && (d2 == D4_RightDir(d1) || d2 == D4_LeftDir(d1));
}

function D4_IsPointOnMap(p) {
	return D4_IsTable(p) && D4_Has(p, "x") && D4_Has(p, "y") && typeof p.x == "integer" && typeof p.y == "integer" && p.x >= 0 && p.y >= 0 && p.x < GSMap.GetMapSizeX() && p.y < GSMap.GetMapSizeY();
}

function D4_ToTile(p) {
	return GSMap.GetTileIndex(p.x, p.y);
}

function D4_FromTile(tile) {
	return { x = GSMap.GetTileX(tile), y = GSMap.GetTileY(tile) };
}

function D4_TrackForDirection(dir) {
	if (dir == DIR_NE || dir == DIR_SW) return GSRail.RAILTRACK_NE_SW;
	return GSRail.RAILTRACK_NW_SE;
}
