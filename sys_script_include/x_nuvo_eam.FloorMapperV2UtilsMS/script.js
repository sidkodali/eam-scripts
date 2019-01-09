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
			"spaces":[],
			"spaceMap":{}
		};
		var limit = 0;

		//Process first record
		var thisSpace = new GlideRecord('x_nuvo_eam_space');
		thisSpace.get(s);
		moveUp(thisSpace);
		moveDown(thisSpace);


		function moveUp(spacerecord) {

			limit++;
			if (limit>100) {return;}
			var current_h = h.find(spacerecord.getValue('document_table'));
			if (current_h.inherit) {
				moveParallel(spacerecord);
			} else {
				addToMap(spacerecord);
			}
			if (current_h.parent_f!=null) {
				var parent = new GlideRecord('x_nuvo_eam_space');
				if (!spacerecord.parent){return;}
				parent.get(spacerecord.parent.space.toString());
				if(!parent){return;}
				moveUp(parent);
			}

		}

		function moveDown(spacerecord) {
			limit++;
			if (limit>100) {return;}

			var current_h = h.find(spacerecord.getValue('document_table'));
			if (!(current_h.children.length>0)) {
				return;
			}
			var childspace = new GlideRecord('x_nuvo_eam_space');
			childspace.addQuery('parent',spacerecord.getValue('document_id'));
			childspace.query();
			while (childspace.next()) {
				addToMap(childspace);
				moveDown(childspace);
			}
		}

		function moveParallel(spacerecord) {
			var spaceinherit = new GlideRecord('x_nuvo_eam_space');
			spaceinherit.addQuery('parent',spacerecord.getValue('parent'));
			spaceinherit.query();
			while (spaceinherit.next()) {
				addToMap(spaceinherit);
			}
		}

		returnSpaceMap.locations = "";
		returnSpaceMap.spaceTypes = [];
		returnSpaceMap.spaceType_map = {};
		var gr = new GlideRecord('x_nuvo_eam_space_type');
		gr.query();
		while (gr.next()) {
			returnSpaceMap.spaceType_map[gr.getUniqueValue()] = {
				"index":returnSpaceMap.spaceTypes.length
			};
			returnSpaceMap.spaceTypes.push(jsonify(gr));
		}

		for (var si = 0; si<returnSpaceMap.spaces.length; si++) {
			var thisSpaceType;
			var thisSpace_type = returnSpaceMap.spaces[si];
			if (thisSpace_type.type.value!=""&&returnSpaceMap.spaceType_map[thisSpace_type.type.value]) {
				var thisSpaceTypeIndex = returnSpaceMap.spaceType_map[thisSpace_type.type.value].index;
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
			returnSpaceMap.spaceMap[space.getUniqueValue()] = {"index":returnSpaceMap.spaces.length};
			returnSpaceMap.spaces.push(spacegr_json);
		}

		function jsonify(gr) {
			var returnRecord = {};
			// Grab all field elements from GlideRecord
			var elements = gr.getElements();
			// Build field dictionary
			for (var i=0; i<elements.length; i++) {
				var thisElm = elements[i];
				//var thisElm_ed = thisElm.getED();
				if (gr.isValidField(thisElm.getName())) {
					returnRecord[thisElm.getName()] = {
						"value":thisElm.toString(),
						"display":thisElm.getDisplayValue()
					};

					/*if (thisElm.getName()=='document_id'&&thisElm.toString()!="") {
						returnRecord[thisElm.getName()].reference = jsonify(thisElm.getRefRecord());
					}*/
					if (thisElm.getName()=='parent'&&thisElm.toString()!="") {
						returnRecord[thisElm.getName()].parentSpace = thisElm.space.toString();
						//jsonify(thisElm.getRefRecord());
					}
				}
			}
			return returnRecord;
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

	type: 'FloorMapperV2UtilsMS'
};
