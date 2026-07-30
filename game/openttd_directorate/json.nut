function D4_JsonHexNibble(value) {
	local digits = "0123456789abcdef";
	return digits.slice(value, value + 1);
}

function D4_JsonEncode(value) {
	local t = typeof value;
	if (value == null) return "null";
	if (t == "bool") return value ? "true" : "false";
	if (t == "integer" || t == "float") return value.tostring();
	if (t == "string") return "\"" + D4_JsonEscape(value) + "\"";
	if (t == "array") {
		local out = "[";
		for (local i = 0; i < value.len() && i < 512; i++) {
			if (i > 0) out += ",";
			out += D4_JsonEncode(value[i]);
		}
		return out + "]";
	}
	if (t == "table") {
		local keys = [];
		foreach (k, v in value) keys.append(k.tostring());
		keys.sort();
		local out = "{";
		for (local i = 0; i < keys.len() && i < 256; i++) {
			if (i > 0) out += ",";
			local k = keys[i];
			out += "\"" + D4_JsonEscape(k) + "\":" + D4_JsonEncode(value[k]);
		}
		return out + "}";
	}
	return "\"unsupported\"";
}

function D4_JsonEscape(text) {
	local out = "";
	for (local i = 0; i < text.len() && i < 8192; i++) {
		local ch = text.slice(i, i + 1);
		if (ch == "\\") out += "\\\\";
		else if (ch == "\"") out += "\\\"";
		else if (ch == "\n") out += "\\n";
		else if (ch == "\r") out += "\\r";
		else if (text[i] < 32) out += "\\u00" + D4_JsonHexNibble(text[i] / 16) + D4_JsonHexNibble(text[i] % 16);
		else out += ch;
	}
	return out;
}
