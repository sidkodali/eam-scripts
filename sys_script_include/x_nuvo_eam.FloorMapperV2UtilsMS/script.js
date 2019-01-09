var FloorMapperV2UtilsMS = Class.create();
FloorMapperV2UtilsMS.prototype = {
	initialize: function() {
		//Define location hierarchy
		//TODO: Replace by reading from properties framework once built
		this.DEBUG = true;
		this._L = new x_nuvo_eam.LocationHierarchy().hierarchy;
		this.useSimpleCRS = false;
		this._SEARCHTABLES = "x_nuvo_eam_floor,x_nuvo_eam_elocation,x_nuvo_eam_zones";
		this.JSON = new global.JSON();
		this.grToJSON = new x_nuvo_eam.GlideRecordToJSON();
	},

	/** Log through a debug function so we can turn it on and off

	writeLog : function(message) {
		if (this.DEBUG) {
			gs.info("x_nuvo_eam.FloorMapperV2UtilsMS: " + message);
		}
	},*/

	/**
	* Based on referer header of incoming SCRAPI request,
	* get array of tables that are marked as searchable
	* @return [tableNames]
	*/
	getSearchableTables : function(refererURLString){
		// can be moved to db as required
		var appRegistry = {space_reservation:
						   ["x_nuvo_eam_floor","x_nuvo_eam_elocation",
							"x_nuvo_eam_zones", "x_nuvo_eam_campus",
							"x_nuvo_eam_building"]};
		var tables;
		Object.keys(appRegistry).some(function(appName){
			if(refererURLString.indexOf(appName) > -1){
				tables = appRegistry[appName];
				return true;
			}
		});

		return tables ? tables : this._SEARCHTABLES.split(",");
	},

	/**
	* Method used to retrieve child spaces given a parent space ID.
	* Overloaded with optional searchTableArr
	* If no args, return top-level with default searchableTables
	* If s == Array, return top-level + given array (which are tables)
	* If s and no Array, return s + default tables
	* If s && Array, return result
	*/
	retreiveChildSpaces : function(s, searchTableArr) {
		/* Check for top-level (i.e. missing s) + searchableTables */
		if(s && Array.isArray(s)){
			var castToTableArr = s;
			return this._retrieveChildSpaces("", castToTableArr);
		}

		var searchTables =  searchTableArr || this._SEARCHTABLES.split(",");
		return this._retreiveChildSpaces(s, searchTables);

	},

	_retreiveChildSpaces : function(s, searchTables) {
		var returnObj=[];
		var gr = new GlideRecord('x_nuvo_eam_space');
		gr.addQuery('parent',s);
		gr.query();
		while (gr.next()) {
			var grc = new GlideRecord('x_nuvo_eam_space');
			grc.addQuery('parent',gr.getValue('document_id'));
			grc.setLimit(1);
			grc.query();
			var hasChildren = grc.hasNext();
			var doc_table = gr.getValue('document_table') || "MISSING"
			var isSearchable = searchTables.indexOf(doc_table)>-1;
			returnObj.push({
				"name":gr.getDisplayValue(),
				"space_id" : gr.getUniqueValue(),
				"doc_id" : gr.getValue('document_id'),
				"searchable" : isSearchable,
				"hasChildren" : hasChildren
			});
		}
		return returnObj;
	},


	/** Method to query renderer table and build object with rendering logic
 	* @param none
 	* @return object with layer types and renderer
 	*/
	buildRenderers : function() {
		var returnObj = {};
		var gr = new GlideRecord('x_nuvo_eam_space_renderer_layer_types');
		gr.addQuery('active',true);
		gr.query();
		while (gr.next()) {
			returnObj[gr.getUniqueValue()] = {
				"name": gr.getValue('layer_type'),
				"use_default": gr.getValue('use_default'),
				"render_script": gr.getValue('rendering_script')
			};
		}
		return returnObj;
	},

	/** Method to run through location hierarchy & return hierarchical object with data
 	* @param all - boolean input to specify whether record data should be returned, default false
 	* @return hierarchical location JSON
 	*/
	calculateLocationHierarchy : function(all) {
		var return_obj = {}, currentLevel = this._L;
		var JSON = this.JSON;
		var searchable_tables = this._SEARCHTABLES;

		// Default all to false, thus returning a lightweight version of location hierarchy
		if (all==null) {
			all = false;
		}

		findTop(currentLevel);

		function findTop(c_lvl) {
			for (var i = 0; i<currentLevel.length; i++) {
				var thisLevel = c_lvl[i];
				if (checkIfTop(thisLevel)) {
					processLevels(c_lvl[i], return_obj, true);
				} else if (c_lvl[i].hasOwnProperty('children')) {
					findTop(c_lvl[i].children);
				}
			}
		}

		function processLevels(c_obj, t_obj, isTop) {
			// c_obj represents the location hierarchy tree moving down from the top most level (current level)
			// t_obj holds the target object
			if (isTop==null) {
				isTop = false;
			}
			if (!(t_obj.hasOwnProperty(c_obj.level))) {
				t_obj[c_obj.level] = {};
			}
			var gr = new GlideRecord(c_obj.table);
			if (c_obj.parent_f&&!isTop) {
				gr.addQuery(c_obj.parent_f,t_obj.parent);
			}
			gr.addQuery('active',true);
			gr.query();
			while (gr.next()) {
				t_obj[c_obj.level][gr.getUniqueValue()] = {
					"name":gr.getDisplayValue(),
					"label":c_obj.label,
					"space_id" : gr.space.sys_id.toString(),
					"searchable": false
					// TODO: Check for all and return whole record & space later
				};
				var searchable = searchable_tables.split(",");
				for (var searchtable = 0; searchtable<searchable.length; searchtable++) {
					if (gr.getTableName()==searchable[searchtable]) {
						t_obj[c_obj.level][gr.getUniqueValue()].searchable = true;
					}
				}
				if (c_obj.hasOwnProperty('children')) {
					for (var j = 0; j<c_obj.children.length; j++) {
						t_obj[c_obj.level][gr.getUniqueValue()].children = {
							"parent":gr.getUniqueValue(),
							"parent_f" : c_obj.parent_f
						};
						processLevels(c_obj.children[j],
									  t_obj[c_obj.level][gr.getUniqueValue()].children);
					}
				}
			}
		}

		function checkIfTop(o) {
			return o.top ? true : false;
		}

		return return_obj;


	},

	/** Method to drive omni-search box on floor mapper UI
 	* @param q - query string used to search across all space records & return results
 	* @return array of data(space.sys_id)/value(space.document_id.displayValue) pair objects
 	*/
	omniSearch : function(q) {

		// TODO : Define framework for configuring searchable tables, search priority, field containing location to jump to, etc...

		// For now, just search through spaces where name contains q
		var gr = new GlideRecord('x_nuvo_eam_space');
		gr.addQuery('name','CONTAINS',q).addOrCondition('sys_id',q);
		gr.addQuery('document_table','IN',this._SEARCHTABLES);
		gr.addQuery('active',true);
		gr.addNotNullQuery('parent');
		// TODO : Drive search query limits via property
		gr.setLimit(6);
		gr.query();

		var results = [];

		while (gr.next()) {
			var tmpObj = {
				"value": gr.getDisplayValue()+" ("+gr.parent.getDisplayValue()+")",
				"data": gr.getUniqueValue()//this.getLayersForSpace(gr)
			};
			results.push(tmpObj);
		}

		return results;
	},

	/** Method returns all space layers given a space record's sys_id ordered by order field, various methods defined given space type
 	* @param s - space GlideRecord or sys_id
 	* @return array of space layer objects for that space
 	* TODO: Build logic somewhere to return space layer objects up and down the hierarchy chain
 	*/
	buildLayers : function(s) {
		if (typeof s == 'string') {
			gr = new GlideRecord('x_nuvo_eam_space');
			gr.get(s);
			s = gr;
		}
		var retrieveSpaceLayers = this.retrieveSpaceLayers,
			returnPlaceInHierarchy = this._returnPlaceInHierarchy,
			_L = this._L;
		var currentTable = s.document_table.toString(),
			thisLevel = this._returnPlaceInHierarchy(currentTable, this._L),
			returnData = {'useSimpleCRS':false},
			returnObj = {};
		var JSON = this.JSON;
		// Populate returnObj down the chain

		calculateLayersDown(s, thisLevel, returnObj);
		if (thisLevel.parent_t) {
			returnObj = calculateLayersUp(s, thisLevel, returnObj);
		}

		function calculateLayersDown(s, h, r) {
			if (h.inherit) {
				// Go up one level & grab space layers for all with same parent
				var spaceQueryInherit = "spaceIN";
				spaceQueryInherit+=retrieveParallelSpaces(s, h);
				r[h.level] = {
					"layer_data":retrieveSpaceLayers(spaceQueryInherit),
					"layer_label":h.level,
					"children":{}
				};
			} else {
				// Build space layers for the given space
				var spaceQuery = "spaceIN"+s.getUniqueValue();
				r[h.level] = {
					"layer_data":retrieveSpaceLayers(spaceQuery),
					"layer_label":h.level,
					"children":{}
				};
			}
			for (var i=0; i<h.children.length; i++) {
				calculateLayersDown(retrieveChild(s,h.children[i]),
									h.children[i],
									r[h.level].children);
			}
		}

		function calculateLayersUp(s, h, r) {
			var parent_s = retrieveParent(s,h);
			if (parent_s) {
				var parent_h = returnPlaceInHierarchy(h.parent_t, _L);
				var parent_spaceQuery = "spaceIN"+parent_s.getUniqueValue();
				var tmp_r  = {};

				tmp_r[parent_h.level] =
					{
					"layer_data":retrieveSpaceLayers(parent_spaceQuery),
					"layer_label":parent_h.level,
					"children":r
				};
				r = tmp_r;
				if (parent_h.parent_t) {
					return calculateLayersUp(parent_s, parent_h, r);
				} else {
					return r;
				}
			} else {
				// No parent, so just return
				return r;
			}
		}

		// Returns a single child space off of which we will pivot
		function retrieveChild(s,h) {
			var gr = new GlideRecord(h.table);
			gr.addQuery(h.parent_f, s.document_id.toString());
			gr.addQuery('active',true);
			gr.setLimit(1);
			gr.query();
			while (gr.next()) {
				return gr.space.getRefRecord();
			}
		}

		// Returns parent from hierarchy given space
		function retrieveParent(s,h) {
			var gr = new GlideRecord(h.parent_t);
			gr.addQuery('sys_id', s.document_id[h.parent_f]);
			gr.addQuery('active',true);
			gr.setLimit(1);
			gr.query();
			while (gr.next()) {
				return gr.space.getRefRecord();
			}
		}

		// Returns comma separated space sys_id's
		function retrieveParallelSpaces(s,h) {
			if (typeof s == 'undefined') {
				return "";
			}
			var gr = new GlideRecord(h.table);
			gr.addQuery(h.parent_f, s.document_id[h.parent_f]);
			gr.addQuery('active',true);
			gr.query();

			var return_ids = "";

			while (gr.next()) {
				return_ids += gr.space.toString()+",";
			}
			return return_ids.substring(0,return_ids.length-1);
		}

		returnData.returnObj = returnObj;
		returnData.useSimpleCRS = this.checkIfAnyAutocad(s);//this.useSimpleCRS;

		return returnData;

	},

	checkIfAnyAutocad : function(spacegr) {
		var isCad = false;
		var gr = new GlideAggregate('x_nuvo_eam_space_layer');
		gr.addQuery('active',true);
		gr.addQuery('space',spacegr.getUniqueValue())
			.addOrCondition('space.parent',spacegr.getValue('document_id'));
		gr.groupBy('dxf_record_details_ref');
		gr.addAggregate('count');
		gr.query();

		while (gr.next()) {
			if ((gr.getValue('dxf_record_details_ref')!='')&&(gr.getValue('dxf_record_details_ref')!=null)) {
				isCad = true;
			}
		}
		return isCad;
	},

	/* Return array of space layer data given an encoded query
 	*
 	*
 	*/
	retrieveSpaceLayers : function(q) {
		var self = this;
		var gr = new GlideRecord('x_nuvo_eam_space_layer');
		gr.addEncodedQuery(q);
		gr.addQuery('active',true);
		gr.orderBy('order');
		gr.query();

		var space_layers = [];

		while (gr.next()) {
			var spaceDocTable = gr.space.document_table.toString();
			var hierarchyHelper = new x_nuvo_eam.LocationHierarchy();
			var spaceLevel = hierarchyHelper.find(spaceDocTable);
			var tmpObj = {};
			tmpObj.space = gr.getValue('space');
			tmpObj.show_on_load = gr.getValue('show_on_load');
			tmpObj.layer_id = gr.getUniqueValue();
			tmpObj.showControl = spaceLevel.display_layer_picker;
			tmpObj.level = spaceLevel.label;
			tmpObj.space_layer_type = gr.getValue('type');
			tmpObj.space_name = gr.space.document_id.getDisplayValue();
			tmpObj.document = gr.space.document_id.toString();
			tmpObj.order = gr.getValue('order');
			tmpObj.feature_groups = {};
			tmpObj.space_layer_name = gr.getValue('name');

			var grd = new GlideRecord('x_nuvo_eam_space_layer_details');
			grd.addQuery('space_layer',gr.getUniqueValue());
			grd.addQuery('active',true);
			grd.query();
			if (!grd.hasNext()) {
				continue;
			}
			while (grd.next()) {
				if (!tmpObj.feature_groups[grd.getValue('layer_data_type')]){
					tmpObj.feature_groups[grd.getValue('layer_data_type')] = {
						"document_id":gr.space.document_id.toString(),
						"space_id":gr.space.toString(),
						"type": "FeatureCollection",
						"properties": {
							"renderer":grd.getValue('layer_data_type')
						},
						"features" : []
					};
				}
				if (!((grd['dxf_staging_table_ref'] == 'undefined')&&(grd['dxf_space_entity_ref'] == 'undefined'))) {
					//returnData.useSimpleCRS = true;
				}
				var thisLayerData = (new global.JSON()).decode(grd.getValue('layer_data'));
				if (!thisLayerData.properties) {
					thisLayerData.properties = {};
				}
				thisLayerData.properties.space_layer_type = gr.getValue('type');
				thisLayerData.properties.space_layer = gr.getUniqueValue();
				thisLayerData.properties.space_layer_title = gr.getDisplayValue();
				thisLayerData.properties.space = gr.getValue('space');
				tmpObj.feature_groups[grd.getValue('layer_data_type')]
					.features.push(thisLayerData);
			}
			space_layers.push(tmpObj);
		}
		return space_layers;
	},



	/** Utility method returns hierarchy object for given space, downwards
 	* @param s - space location table
 	* @return place in hierarchy object corresponding to input table
 	*/
	_returnPlaceInHierarchy : function(thisTable, L) {
		var JSON = new global.JSON();
		//gs.info(thisTable);
		//gs.info(JSON.encode(L));
		return pinpointSpace(thisTable, L);
		function pinpointSpace(table, hierarchy) {
			//gs.info("Table is: " + table);
			//gs.info("H is: " + JSON.encode(hierarchy));
			//gs.info("_L is: " + JSON.encode(hierarchy));
			for (var i=0; i<hierarchy.length; i++) {
				if (hierarchy[i].table == table) {
					return hierarchy[i];
				} else {
					return pinpointSpace(table, hierarchy[i].children);
				}
			}
		}
	},

	/** Utility method that accepts a built Geo Package for Floor Mapper and save to a cached record
 	* @param s<string> - space sys_id
 	* @param d<string> - stringified data package to break up into cache records
 	*/
	cacheGeoData : function(s,d) {

		// Inactivate existing cache data
		this.clearCacheGeoData(s);

		//d = d ? d : this.buildLayers(s);

		var len = d.length;
		var limit = gs.getProperty('x_nuvo_eam.fm_geo_cache_length');
		var sections = Math.ceil(len/limit);

		var cache = new GlideRecord('x_nuvo_eam_space_geo_cache');


		for (var i = 0; i<sections; i++) {
			cache.initialize();
			var datasection = d.substr(limit*i,limit);

			cache.setValue('order',i);
			cache.setValue('space',s);
			cache.setValue('payload',datasection);
			cache.insert();
		}
	},

	clearCacheGeoData : function(s) {
		var cache = new GlideRecord('x_nuvo_eam_space_geo_cache');
		cache.addQuery('space',s);
		cache.query();
		while (cache.next()) {
			cache.setValue('active',false);
			cache.update();
		}
	},

	/** Return relevant spaces along space hierarchy
 	* @param s<string> - sys_id of target space
 	* @return<object> - packaged JSON for client
 	**/
	getHierarchySpaces : function(s) {
		var h = new x_nuvo_eam.LocationHierarchy();
		var returnSpaceMap = {
			spaces: [],
			spaceMap: {}
		};
		var limit = 0;
		//Process first record
		var thisSpace = new GlideRecord("x_nuvo_eam_space");
		thisSpace.get(s);
		var currentSpaceStatus = checkStatus(thisSpace);
		moveUp(thisSpace);
		moveDown(thisSpace);

		function moveUp(spacerecord) {
			limit++;
			if (limit > 100) {
				return;
			}
			var current_h = h.find(spacerecord.getValue("document_table"));
			if (current_h.inherit) {
				moveParallel(spacerecord);
			} else {
				addToMap(spacerecord);
			}
			if (current_h.parent_f != null) {
				var parent = new GlideRecord("x_nuvo_eam_space");
				if (!spacerecord.parent) {
					return;
				}
				var spaceField = spacerecord.parent.space ? 'space' : 'space';
				parent.get(spacerecord.parent[spaceField].toString());
				if (!parent) {
					return;
				}

				if (!currentSpaceStatus) {
					currentSpaceStatus = checkStatus(parent);
				}

				moveUp(parent);
			}
		}

		function moveDown(spacerecord) {
			limit++;
			if (limit > 100) {
				return;
			}

			var current_h = h.find(spacerecord.getValue("document_table"));

			if (!current_h.children.length) {
				return;
			}

			var childspace = new GlideRecord("x_nuvo_eam_space");
			childspace.addQuery("parent", spacerecord.getValue("document_id"));
			childspace.query();
			while (childspace.next()) {
				addToMap(childspace);

				if (!currentSpaceStatus) {
					currentSpaceStatus = checkStatus(childspace);
				}

				moveDown(childspace);
			}
		}

		function moveParallel(spacerecord) {
			var spaceinherit = new GlideRecord("x_nuvo_eam_space");
			spaceinherit.addQuery("parent", spacerecord.getValue("parent"));
			spaceinherit.query();
			while (spaceinherit.next()) {
				addToMap(spaceinherit);
			}
		}

		returnSpaceMap.floorSysID = currentSpaceStatus ? currentSpaceStatus.documentID : '';
		returnSpaceMap.floorSpaceSysID = currentSpaceStatus ? currentSpaceStatus.spaceSysID : '';
		returnSpaceMap.locations = "";
		returnSpaceMap.spaceTypes = [];
		returnSpaceMap.spaceType_map = {};
		var gr = new GlideRecord("x_nuvo_eam_space_type");
		gr.query();
		while (gr.next()) {
			returnSpaceMap.spaceType_map[gr.getUniqueValue()] = {
				index: returnSpaceMap.spaceTypes.length
			};
			returnSpaceMap.spaceTypes.push(jsonify(gr));
		}

		for (var si = 0; si < returnSpaceMap.spaces.length; si++) {
			var thisSpaceType;
			var thisSpace_type = returnSpaceMap.spaces[si];
			if (
				thisSpace_type.type.value != "" &&
				returnSpaceMap.spaceType_map[thisSpace_type.type.value]
			) {
				var thisSpaceTypeIndex =
					returnSpaceMap.spaceType_map[thisSpace_type.type.value].index;
				thisSpaceType = returnSpaceMap.spaceTypes[thisSpaceTypeIndex];
			}
			thisSpace_type.type.reference = thisSpaceType;
		}
		return returnSpaceMap;

		function addToMap(space) {
			if (returnSpaceMap.hasOwnProperty(space.getUniqueValue())) {
				return;
			}
			var spacegr_json = jsonify(space);
			returnSpaceMap.spaceMap[space.getUniqueValue()] = {
				index: returnSpaceMap.spaces.length
			};
			returnSpaceMap.spaces.push(spacegr_json);
		}

		function jsonify(gr) {
			var returnRecord = {};
			// Grab all field elements from GlideRecord
			var elements = gr.getElements();
			// Build field dictionary
			for (var i = 0; i < elements.length; i++) {
				var thisElm = elements[i];

				if (gr.isValidField(thisElm.getName())) {
					returnRecord[thisElm.getName()] = {
						value: thisElm.toString(),
						display: thisElm.getDisplayValue()
					};

					if (thisElm.getName() == "parent" && thisElm.toString() != "") {
						var spaceField = thisElm.space ? 'space' : 'space';
						returnRecord[thisElm.getName()].parentSpace = thisElm[spaceField].toString();
					}
				}
			}
			return returnRecord;
		}

		function checkStatus(gr, h) {
			//TODO DC13 Rename function
			var answer = false;
			//TODO DC13 REMOVE Hardcode
			if (gr.getValue('location_level') === 'floor') {
				answer = {documentID: gr.getValue('document_id'), spaceSysID: gr.getValue('sys_id')};
			}
			return answer;
		}
	},


	/** REST method for retrieving a geo package from cached data. This method will re-build data from cache
 	* @param s<string> - sys_id of target space
 	* @return<object> - packaged JSON for client
 	**/
	retrieveSpaceGeoPackage : function(s) {
		var j = new global.JSON();

		var _s = this.retrieveLowestSpaceWithCache(s);

		var returnData = "";

		var cache = new GlideRecord('x_nuvo_eam_space_geo_cache');
		cache.addQuery('space',_s);
		cache.addQuery('active',true);
		cache.orderBy('order');
		cache.query();
		while (cache.next()) {
			returnData += cache.getValue('payload');
		}
		var returnDataParsed = j.decode(returnData);
		gs.info("DEB:::returnDataParsed" + returnDataParsed);
		returnDataParsed.spaces = this.getHierarchySpaces(s);
		return returnDataParsed;
	},

	retrieveLowestSpaceWithCache : function(s) {

		function searchForCache(spaceid) {
			if (!spaceid){
				return "";
			}
			var cache = new GlideRecord('x_nuvo_eam_space_geo_cache');
			cache.addQuery('space',spaceid);
			cache.addQuery('active',true);
			cache.query();
			if (cache.hasNext()) {
				return spaceid;
			}


			var space_gr = new GlideRecord('x_nuvo_eam_space');
			space_gr.get(s);
			if (!space_gr.get(s)){
				return;
			}
			var parent_doc = space_gr.parent.getRefRecord();
			if (!parent_doc){
				return;
			}
			return searchForCache(parent_doc.getValue('space'));
		}
		return searchForCache(s);
	},
	/*
	- This function calculates the view specific details.
	*/
	calculateViewDetails:function(viewId){
		var m2m = new GlideRecord("x_nuvo_eam_m2m_cafm_layers_space_deskto");
		m2m.addEncodedQuery("space_desktop_view.url_suffix="+viewId);
		m2m.query();
		var result={};
		var layersArr=[];
		var colorBy='';
		var spaceLbl='';
		var name='';

		gs.info('In');
		var ifRecFound=false;
		while(m2m.next()) {
			ifRecFound=true;
			gs.info('CASE');
			var sdView = m2m.space_desktop_view.getRefRecord();
			colorBy = sdView.getValue("color_by");
			spaceLbl = sdView.getDisplayValue("space_label");
			name = sdView.getDisplayValue('name');
			var sdLayers = m2m.cafm_layers.getRefRecord();
			layersArr.push(sdLayers.getValue('name'));
		}
		if(ifRecFound==true){
			result.colorBy=colorBy;
			result.spaceLabel=spaceLbl;
			result.layers=layersArr;
			result.urlSuffix=viewId;
			result.viewId=name;
		}

		return result;
	},

	/**
	1. This function gets the advanced meterics based on the colorby value passed to it
	*/
	getAdvancedMetricsForCore:function(colorBy){
		var response={};
		var m2m=new GlideRecord('x_nuvo_eam_m2m_color_bys_legend_metrics');
		m2m.query('color_by',colorBy);
		m2m.query();
		var arrayRes=[];
		while(m2m.next()){
			var result={};
			var colorByRef=m2m.color_by.getRefRecord();
			var colorByName=colorByRef.getValue('field');
			var refR=m2m.legend_metrics.getRefRecord();
			var active=refR.getValue('active');
			if(!active){
				continue;
			}
			var aggregateFunction=refR.getDisplayValue('aggregate_function');
			var spaceColumn=refR.getDisplayValue('space_column');
			var groupByAggrObj={};
			if(aggregateFunction && spaceColumn){
				var gAggr=new GlideAggregate('x_nuvo_eam_space');
				gAggr.addAggregate(aggregateFunction,spaceColumn);
				gAggr.groupBy(colorByName);
				gAggr.query();
				var label;
				while(gAggr.next()){
					label=gAggr[spaceColumn].getLabel();
					gs.info('For Column:'+label);
					var category = gAggr[colorByName];
					var resAggregate = gAggr.getAggregate(aggregateFunction,spaceColumn);
					gs.info(category+":"+JSON.stringify(resAggregate));
					groupByAggrObj[category]=resAggregate;
				}
				if(label){
					spaceColumn=label;
				}
			}
			result.aggregates=groupByAggrObj;
			var labelOverride=refR.getDisplayValue('label_override');
			result.aggregateFunction=aggregateFunction;
			result.spaceColumn=spaceColumn;
			if(!labelOverride || labelOverride && labelOverride.trim().length<=0){
				labelOverride=spaceColumn+"("+aggregateFunction+")";
			}
			result.label=labelOverride;
			arrayRes.push(result);
		}
		response[colorBy]=arrayRes;
		return response;
	},

	getAttachmentSysIDCore: function(spaceSysID) {
		var attSysID = "";
		var result = {};
		var spaceGR = new GlideRecord('x_nuvo_eam_space');
		spaceGR.get(spaceSysID);

		if(spaceGR.getValue('parent_table') == 'x_nuvo_eam_floor') {
			spaceSysID = spaceGR.parent.space;
		}

		var attRec = new GlideRecord("sys_attachment");
		attRec.addQuery("table_name", "x_nuvo_eam_space");
		attRec.addQuery("table_sys_id", spaceSysID);
		attRec.orderByDesc("sys_created_on");
		attRec.query();
		if(attRec.next()){
			attSysID = attRec.sys_id.toString();
		}
		result.attSysID = attSysID;
		result.spaces = this.getHierarchySpaces(spaceSysID);
		return result;
	},

	//Function to get logged in user roles.
	getUserSpaceRoles: function(userID) {

		var spaceRoles = gs.getProperty('x_nuvo_eam.user_space_roles');
		var userSpaceRoles = '';
		var grUserRoles = new GlideRecord('sys_user_has_role');
		grUserRoles.addQuery('user',userID);
		grUserRoles.addQuery('role','IN',spaceRoles);
		grUserRoles.query();
		while(grUserRoles.next()){
			userSpaceRoles = userSpaceRoles + ',' + grUserRoles.role;
		}

		if(userSpaceRoles == '') {

			var grUserRoles2 = new GlideRecord('sys_user_has_role');
			grUserRoles2.addQuery('user',userID);
			grUserRoles2.addQuery('role.name','admin');
			grUserRoles2.query();
			if(grUserRoles2.next()){
				userSpaceRoles = spaceRoles;
			}

		}
		else if(userSpaceRoles != ''){

			userSpaceRoles = userSpaceRoles.substr(1,userSpaceRoles.length);
		}

		return userSpaceRoles;

	},

	getUsers : getUsersFn,
	getUsersByCampus : getUsersByCampus4,
	moveUsertoSpace : moveUsertoSpaceFn,
	calculateViewList:calculateViewListFn_v1,
	getSpaceLabelOrColorBy: getSpaceLabelOrColorByFn_v1,

	type: 'FloorMapperV2UtilsMS'
};

// function getSpaceLabelOrColorByFn(type,spaceViewObj){
// 	gs.info('@TEST1:'+type+":"+JSON.stringify(spaceViewObj.getValue('application')));
// 	var resultArr=[];
// 	var tableName = (type=="color")? "x_nuvo_eam_color_by" : "x_nuvo_eam_space_label";
// 	var application=spaceViewObj.getValue('application');
// 	var appArr=[];
// 	if(application && application!=''){
// 		appArr=application.split(',');
// 		for(var appKey in appArr){
// 			var currApp=appArr[appKey];
// 			resultArr=findSpaceOrColorSysID(resultArr,currApp);
// 		}
// 	}else{
// 		resultArr=findSpaceOrColorSysID(resultArr);
// 	}
// 	return resultArr.toString();

// 	function findSpaceOrColorSysID(resultArr,currApp){
// 		var gr=new GlideRecord(tableName);
// 		var eq='';
// 		if(currApp){
// 			eq = "applicationLIKE"+currApp;
// 			gr.addEncodedQuery(eq);
// 		}else{
// 			eq= "applicationISEMPTY";
// 			gr.addEncodedQuery(eq);
// 		}
// 		gr.query();
// 		while(gr.next()){
// 			resultArr.push(gr.getValue('sys_id'));
// 		}
// 		return resultArr;
// 	}
// }

function getSpaceLabelOrColorByFn_v1(type,spaceViewObj){
	gs.info('@TEST1:'+type+":"+JSON.stringify(spaceViewObj.getValue('application')));
	var resultArr=[];
	var tableName = (type=="color")? "x_nuvo_eam_color_by" : "x_nuvo_eam_space_label";
	var application=spaceViewObj.getValue('application');
	var appArr=[];
	if(application && application!=''){
		appArr=application.split(',');
		resultArr=findSpaceOrColorSysID(resultArr,appArr);
	}else{
		resultArr=findSpaceOrColorSysID(resultArr);
	}
	return resultArr.toString();

	function findSpaceOrColorSysID(resultArr,appArr){
		var gr=new GlideRecord(tableName);
		if(appArr){
			var eq=null;
			for(var appKey in appArr){
				var currApp=appArr[appKey];
				if(eq){
					eq="^"+"applicationLIKE"+currApp;
				}else{
					eq="applicationLIKE"+currApp;
				}
			}
			gr.addEncodedQuery(eq);
		}else{
			var eq1='';
			eq1= "applicationISEMPTY";
			gr.addEncodedQuery(eq1);
		}
		gr.query();
		while(gr.next()){
			resultArr.push(gr.getValue('sys_id'));
		}
		return resultArr;
	}
}

/*
	- This function calculates the list of views and returns the same.
	- First calculate all the views from the space_desktop view
	- Next For each view if the colorby belongs to the selected app then select it.
	- - The same view should aso have the spacelabel assigned to that app.
	- If the app is not assigned, then choose colorby and space label with no app.
*/
// function calculateViewListFn(appID){
// 	gs.info('@Firstone:app'+appID);
// 	var response=[];
// 	var spaceViewGR=new GlideRecord('x_nuvo_eam_space_desktop_view');
// 	spaceViewGR.query();
// 	while(spaceViewGR.next()){
// 		var colorByValid=false;
// 		var spaceLabelValid=false;
// 		var viewData={};
// 		var colorBy=spaceViewGR.getValue('color_by');
// 		var colorByGr=new GlideRecord('x_nuvo_eam_color_by');
// 		colorByGr.get(colorBy);
// 		var glideListVal=colorByGr.getValue('application');
// 		var applicationArray=[];
// 		if(glideListVal){
// 			applicationArray=glideListVal.split(',');
// 			if(applicationArray && applicationArray.length>0){
// 				for(var arrKey in applicationArray){
// 					var arrEle=applicationArray[arrKey];
// 					if(arrEle==appID){
// 						gs.info('@Firstone:color:match');
// 						//Also match for the space label
// 						colorByValid=true;
// 						break;
// 					}
// 				}
// 			}
// 		}else{
// 			//app list is empty
// 			if(!appID){
// 				colorByValid=true;
// 			}
// 		}

// 		var spaceLabel=spaceViewGR.getValue('space_label');
// 		var spaceLabelGr=new GlideRecord('x_nuvo_eam_space_label');
// 		spaceLabelGr.get(spaceLabel);
// 		var glideListValSpLbl=spaceLabelGr.getValue('application');
// 		var spLblAppArr=[];
// 		if(glideListValSpLbl){
// 			spLblAppArr=glideListValSpLbl.split(',');
// 			if(spLblAppArr && spLblAppArr.length>0){
// 				for(var spLblAppArrKey in spLblAppArr){
// 					var spLblAppArrEle=spLblAppArr[spLblAppArrKey];
// 					if(spLblAppArrEle==appID){
// 						spaceLabelValid=true;
// 						break;
// 					}
// 				}
// 			}
// 		}else{
// 			//app list is empty
// 			if(!appID){
// 				spaceLabelValid=true;
// 			}
// 		}
// 		if(spaceLabelValid==true && colorByValid==true){
// 			viewData={};
// 			viewData.viewId=spaceViewGR.getDisplayValue('name');
// 			viewData.urlSuffix=spaceViewGR.getDisplayValue('url_suffix');
// 			response.push(viewData);
// 		}
// 	}
// 	return response;
// }

function calculateViewListFn_v1(appID){
	gs.info('@Firstone:app'+appID);
	var response=[];
	var spaceViewGR=new GlideRecord('x_nuvo_eam_space_desktop_view');
	spaceViewGR.addQuery('active',true);
	spaceViewGR.query();
	while(spaceViewGR.next()){
		var colorByValid=false;
		var spaceLabelValid=false;
		var viewData={};
		var application=spaceViewGR.getValue('application');
		var appArr=[];
		if(application){
			appArr=application.split(',');
			for(var appKey in appArr){
				var appEle=appArr[appKey];
				if(appEle==appID){
					viewData={};
					viewData.viewId=spaceViewGR.getDisplayValue('name');
					viewData.urlSuffix=spaceViewGR.getDisplayValue('url_suffix');
					response.push(viewData);
					break;
				}
			}
		}else{
			if(!appID){
				viewData={};
				viewData.viewId=spaceViewGR.getDisplayValue('name');
				viewData.urlSuffix=spaceViewGR.getDisplayValue('url_suffix');
				response.push(viewData);
			}
		}
	}
	return response;
}

function getUsersFn(userQuery){
	var filteredUsers = _createUserJSON('NONUMBER',userQuery);
	return filteredUsers;
}

function _createUserJSON(moveNumber,userQuery){
	var user = '';
	var plannedMove = new GlideRecord('x_nuvo_eam_planned_move');
	plannedMove.addQuery('number',moveNumber);
	plannedMove.query();
	if(plannedMove.next()){
		if(plannedMove.move_type == 'Single User')
			user = plannedMove.user_to_be_moved.sys_id.toString();
	}
	var users = [];
	var moveUsers = new GlideRecord('sys_user');
	moveUsers.addQuery('active',true);
	if(user!='')
		moveUsers.addQuery('sys_id',user);
	else if(userQuery!='empty')
		moveUsers.addEncodedQuery(userQuery);
	//var limit = gs.getProperty('x_nuvo_eam.space_planner_max_users_assets_onload');
	//moveUsers.setLimit(limit);
	moveUsers.orderBy("name");
	moveUsers.query();
	while(moveUsers.next()){
		var item = {};
		item.name = moveUsers.getValue('name');
		item.sys_id = moveUsers.getUniqueValue();
		var locWorkspaceRes=getLocWorkspace(moveUsers.sys_id);

		// 		var wrkSpace = moveUsers.getValue('u_workspace');
		// 		var wrkSpaceDV = moveUsers.getDisplayValue('u_workspace');
		//var locationStr = this._getUsersToLocationM2M(moveUsers.sys_id);
		if(locWorkspaceRes && locWorkspaceRes.workspace){
			item.workspace = locWorkspaceRes.workspace;
			item.availability = "user-circle-not-available";
			item.locDetails = locWorkspaceRes.location;
		}
		else{
			item.availability = "user-circle-available";
		}
		if(moveUsers.photo.getDisplayValue() != "")
			item.photo = moveUsers.photo.getDisplayValue();
		else {
			item.photo = 'avatar.png';
		}
		users.push(item);
	}
	return users;
}

function getLocWorkspace(userSysID){
	var locWorkspaceRes=null;
	var userToLocRec = new GlideRecord("x_nuvo_eam_users_assigned_to_location_m2m");
	userToLocRec.addQuery("user", userSysID);
	userToLocRec.addQuery('primary_location',true);
	userToLocRec.query();
	if(userToLocRec.next()){
		locWorkspaceRes={};
		locWorkspaceRes.workspace=userToLocRec.getValue("location");
		locWorkspaceRes.location=userToLocRec.getDisplayValue("location");
	}
	return locWorkspaceRes;
}

// function _getUsersToLocationM2M(userSysID){
// 	var locationStr = "";
// 	var userToLocRec = new GlideRecord("x_nuvo_eam_users_assigned_to_location_m2m");
// 	userToLocRec.addQuery("user", userSysID);
// 	userToLocRec.query();
// 	while(userToLocRec.next()){
// 		var isPrimary = userToLocRec.primary_location;
// 		if(isPrimary){
// 			locationStr += userToLocRec.getDisplayValue("location").toString() + "(P),";
// 		}
// 		else{
// 			locationStr += userToLocRec.getDisplayValue("location").toString() + ",";
// 		}
// 	}
// 	if(locationStr != ""){
// 		locationStr = locationStr.substring(0, locationStr.length-1);
// 	}
// 	return locationStr;
// }


// function getUsersInCampusFn(floorID,userList){
// 	var usersRes=[];
// 	if(!floorID){
// 		return usersRes;
// 	}
// 	var floorGR = new GlideRecord('x_nuvo_eam_floor');
// 	floorGR.addQuery('space.sys_id',floorID);
// 	floorGR.query();
// 	if(floorGR.next()){
// 		var site=floorGR.building.getRefRecord();
// 		gs.info('Site'+site);
// 		var site_sys_id=site.sys_id;
// 		gs.info('Sys_id:'+site_sys_id);
// 		var locM2m=new GlideRecord('x_nuvo_eam_users_assigned_to_location_m2m');
// 		locM2m.addEncodedQuery('primary_location=true^location.floor.building.sys_idSTARTSWITH'+site_sys_id);
// 		if(null!=userList && 'null'!=userList && ''!=userList.trim()){
// 			locM2m.addQuery('user','IN',userList);
// 		}
// 		locM2m.orderBy('user');
// 		locM2m.query();
// 		while(locM2m.next()){
// 			var userToPush={};
// 			var userSysID=locM2m.getValue('user');
// 			var userName=locM2m.getDisplayValue('user');
// 			var userRef=locM2m.user.getRefRecord();
// 			var userSysIDGot=userRef.sys_id;
// // 			var workspaceDtls=locM2m.getDisplayValue('location');
// 			var workspaceDtls= _getUsersToLocationM2M(userSysIDGot);
// 			var userPic='avatar.png';
// 			var userGR=new GlideRecord('sys_user');
// 			if(workspaceDtls && workspaceDtls.trim().length>0){
// 				userToPush.locDetails=workspaceDtls;
// 				userToPush.workspace=workspaceDtls;
// 				userToPush.availability = "user-circle-not-available";
// 			}else{
// 				userToPush.availability = "user-circle-available";
// 			}
// 			userGR.addQuery('sys_id',userSysID);
// 			userGR.query();
// 			if(userGR.next()){
// 				var pic=userGR.getDisplayValue('photo');
// 				if(pic){
// 					userPic=pic;
// 				}
// 			}
// 			userToPush.name=userName;
// 			userToPush.photo=userPic;
// 			userToPush.sys_id=userSysID;

// 			gs.info('User'+userName+":"+userPic);
// 			usersRes.push(userToPush);
// 		}
// 	}
// 	return usersRes;
// }

function moveUsertoSpaceFn(type,locSysID,userSysID){
	var result = {};
	var msg = "";
	var userToSpaceRec = new GlideRecord("x_nuvo_eam_users_assigned_to_location_m2m");
	userToSpaceRec.addQuery("user", userSysID);
	userToSpaceRec.query();
	if(userToSpaceRec.next()){
		var userToSpaceRec1 = new GlideRecord("x_nuvo_eam_users_assigned_to_location_m2m");
		userToSpaceRec1.addQuery("location", locSysID);
		userToSpaceRec1.addQuery("user", userSysID);
		userToSpaceRec1.query();
		if(userToSpaceRec1.next()){
			msg = "Exists";
		}
		else{
			msg = "Not Exists";
		}
	}
	else{
		if(type == "available"){
			var userToSpaceRec2 = new GlideRecord("x_nuvo_eam_users_assigned_to_location_m2m");
			userToSpaceRec2.initialize();
			userToSpaceRec2.location = locSysID;
			userToSpaceRec2.user = userSysID;
			userToSpaceRec2.insert();
		}
		msg = "Inserted";
	}
	result["message"] = msg;
	return result;
}

// function getUsersByCampusFn1(floorID,userList){
// 	gs.info("getUsersByCampus floorID "+floorID);
// 	var locRefID = '';
// 	var users = [];

// 	var floorGR = new GlideRecord('x_nuvo_eam_floor');
// 	floorGR.addQuery('space.sys_id',floorID);
// 	floorGR.query();
// 	if(floorGR.next()){
// 		locRefID = floorGR.building.campus.u_location_ref;
// 	}
// 	gs.info("getUsersByCampus locRefID "+locRefID);
// 	var empGR = new GlideRecord('sys_user');
// 	//empGR.addQuery('u_workspace.location.floor.building.campus.u_location_ref',locRefID);
// 	if(null!=userList && 'null'!=userList && ''!=userList.trim()){
// 		gs.info("User Condition is true");
// 		empGR.addQuery('sys_id','IN',userList);
// 	}
// 	empGR.addQuery('location',locRefID);
// 	empGR.addQuery('active',true);
// 	empGR.orderBy("name");
// 	empGR.query();
// 	while(empGR.next()){
// 		gs.info('getUsersByCampus name '+empGR.name.toString());
// 		var item = {};
// 		item.name = empGR.getValue('name');
// 		item.sys_id = empGR.getUniqueValue();
// 		item.workspace = _getUsersToLocationM2M(empGR.sys_id);
// // 		var wrkSpace = empGR.getValue('u_workspace');
// // 		var wrkSpaceDV = empGR.getDisplayValue('u_workspace');
// // 		var locationStr = this._getUsersToLocationM2M(empGR.sys_id);
// 		if(item.workspace && item.workspace.trim().length>0){
// // 			gs.info("wrkSpace "+wrkSpace+"name "+item.name);
// 			item.availability = "user-circle-not-available";
// 			item.locDetails = item.workspace;
// 		}
// 		else{
// 			item.availability = "user-circle-available";
// 			item.locDetails = " ";
// 		}
// 		if(empGR.photo.getDisplayValue() != "")
// 			item.photo = empGR.photo.getDisplayValue();
// 		else {
// 			item.photo = 'avatar.png';
// 		}
// 		users.push(item);

// 	}
// 	return users;
// }

//  function getUsersByCampus3(floorID,userList){
// 		gs.info("getUsersByCampus floorID "+floorID);
// 		var site;
// 		var users = [];

// 		var floorGR = new GlideRecord('x_nuvo_eam_floor');
// 		floorGR.addQuery('space.sys_id',floorID);
// 		floorGR.query();
// 		if(floorGR.next()){
// 			site = floorGR.building.getRefRecord();
// 			gs.info('Site'+site);

// 		}
// 		var site_sys_id=site.sys_id;
// 		//gs.info("getUsersByCampus locRefID "+locRefID);
// 		var empGR = new GlideRecord('x_nuvo_eam_users_assigned_to_location_m2m');
// 		//empGR.addQuery('u_workspace.location.floor.building.campus.u_location_ref',locRefID);
// 		if(null!=userList && 'null'!=userList && ''!=userList.trim()){
// 			gs.info("User Condition is true");
// 			empGR.addQuery('user','IN',userList);
// 		}
// 		empGR.addEncodedQuery('primary_location=true^location.floor.building.sys_idSTARTSWITH'+site_sys_id);
// 		empGR.orderBy("user");
// 		empGR.query();
// 		while(empGR.next()){
// 			//gs.info('getUsersByCampus name '+empGR.name.toString());
// 			var item = {};
// 			var userSysID=empGR.getValue('user');
// 			var userName=empGR.getDisplayValue('user');
// 			item.name =userName;
// 			item.sys_id = userSysID;
// 			var userPic='avatar.png';
// 			var userGR=new GlideRecord('sys_user');
// 			userGR.addQuery('sys_id',userSysID);
// 			userGR.query();
// 			if(userGR.next()){
// 				var pic=userGR.getDisplayValue('photo');
// 				if(pic){
// 					userPic=pic;
// 				}
// 			}
// 			item.photo=userPic;
// 			var workspaceDtls=empGR.getValue("location");
// 			var locationDtls=empGR.getDisplayValue("location");
// 			if(workspaceDtls && workspaceDtls.trim().length>0){
// 				item.locDetails=locationDtls;
// 				item.workspace=workspaceDtls;
// 				item.availability = "user-circle-not-available";
// 			}else{
// 				item.availability = "user-circle-available";
// 			}
// 			users.push(item);
// 		}
// 		return users;
// 	}

function getUsersByCampus4(floorID,userList){

	var site;
	var users = [];

	var floorGR = new GlideRecord('x_nuvo_eam_floor');
	floorGR.addQuery('space.sys_id',floorID);
	floorGR.query();
	if(floorGR.next()){
		site = floorGR.building.getRefRecord();
		gs.info('Site'+site);

	}
	var site_sys_id=site.sys_id;
	var maxUsersToLoad=gs.getProperty("x_nuvo_eam.fm_floor_map_max_unassigned_users");
	var user = '';
	var userCount=0;
	var moveUsers = new GlideRecord('sys_user');
	moveUsers.addQuery('active',true);
	moveUsers.orderBy("name");
	moveUsers.query();
	while(moveUsers.next()){
		var item = {};
		item.name = moveUsers.getValue('name');
		item.sys_id = moveUsers.getUniqueValue();
		var locWorkspaceRes=getLocWorkspaceForSite(moveUsers.sys_id,site_sys_id);

		// 		var wrkSpace = moveUsers.getValue('u_workspace');
		// 		var wrkSpaceDV = moveUsers.getDisplayValue('u_workspace');
		//var locationStr = this._getUsersToLocationM2M(moveUsers.sys_id);
		if(locWorkspaceRes && locWorkspaceRes.workspace){
			item.workspace = locWorkspaceRes.workspace;
			item.availability = "user-circle-not-available";
			item.locDetails = locWorkspaceRes.location;
		}
		else{
			item.availability = "user-circle-available";
			if(maxUsersToLoad){
				if(userCount<maxUsersToLoad){
					userCount++;
				}else{
					break;
				}
			}
		}
		if(moveUsers.photo.getDisplayValue() != "")
			item.photo = moveUsers.photo.getDisplayValue();
		else {
			item.photo = 'avatar.png';
		}
		users.push(item);
	}
	return users;
}
function getLocWorkspaceForSite(userSysID,siteID){
	var locWorkspaceRes=null;
	var userToLocRec = new GlideRecord("x_nuvo_eam_users_assigned_to_location_m2m");
	userToLocRec.addQuery("user", userSysID);
	if(siteID){
		userToLocRec.addEncodedQuery('location.floor.building.sys_idSTARTSWITH'+siteID);
	}
	userToLocRec.addQuery('primary_location',true);
	userToLocRec.query();
	if(userToLocRec.next()){
		locWorkspaceRes={};
		locWorkspaceRes.workspace=userToLocRec.getValue("location");
		locWorkspaceRes.location=userToLocRec.getDisplayValue("location");
	}
	return locWorkspaceRes;
}
