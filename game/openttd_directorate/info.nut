class OpenTTDDirectorateInfo extends GSInfo {
	function GetAuthor()      { return "OpenTTD Directorate clean-room contributors"; }
	function GetName()        { return "OpenTTD Directorate"; }
	function GetDescription() { return "Route registry, vehicle commissioning, economic verification, and health/alerts for OpenTTD Directorate."; }
	function GetVersion()     { return 4; }
	function MinVersionToLoad(){ return 1; }
	function GetDate()        { return "2026-07-30"; }
	function CreateInstance() { return "OpenTTDDirectorate"; }
	function GetShortName()   { return "DRCT"; }
	function GetAPIVersion()  { return "15"; }

	function GetSettings() {
		AddSetting({ name = "poll_limit", description = "Maximum Admin requests polled per script tick", min_value = 1, max_value = 16, easy_value = 4, medium_value = 4, hard_value = 4, custom_value = 4, flags = CONFIG_INGAME });
		AddSetting({ name = "expansion_limit", description = "Maximum planner node expansions per request or tick", min_value = 8, max_value = 512, easy_value = 96, medium_value = 96, hard_value = 96, custom_value = 96, flags = CONFIG_INGAME });
		AddSetting({ name = "frontier_limit", description = "Maximum frontier entries per plan", min_value = 32, max_value = 4096, easy_value = 512, medium_value = 512, hard_value = 512, custom_value = 512, flags = CONFIG_INGAME });
		AddSetting({ name = "path_limit", description = "Maximum centerline path length", min_value = 8, max_value = 1024, easy_value = 256, medium_value = 256, hard_value = 256, custom_value = 256, flags = CONFIG_INGAME });
		AddSetting({ name = "retention_limit", description = "Maximum completed/cancelled plans kept queryable", min_value = 8, max_value = 256, easy_value = 64, medium_value = 64, hard_value = 64, custom_value = 64, flags = CONFIG_INGAME });
		AddSetting({ name = "reserve_default", description = "Default cash reserve for apply operations", min_value = 0, max_value = 500000, easy_value = 50000, medium_value = 50000, hard_value = 50000, custom_value = 50000, flags = CONFIG_INGAME });
	}
}

RegisterGS(OpenTTDDirectorateInfo());
