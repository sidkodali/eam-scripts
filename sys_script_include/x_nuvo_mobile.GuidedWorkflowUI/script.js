var GuidedWorkflowUI = Class.create();
GuidedWorkflowUI.prototype = {
    initialize: function() {
		this._workflow_recipe_table = "x_nuvo_eam_guided_workflow_ui_definition";
		this._workflow_step_table = "x_nuvo_eam_guided_workflow_steps";
    },

	_getTableFromURLConfig: function(url_param){
		var gr = new GlideRecord(this._workflow_recipe_table);
		gr.get("url_parameter", url_param);
		if(gr){
			return gr.getValue("table");
		}

		var log = ["No table found on Guided Workflow definition record for URL ", url_param].join("");
		gs.error(log);
	},

	_getGR: function(sys_id, tableName, url_param){
		if(!sys_id || !tableName){
			var log = ["Missing required params for building stateful UI Object",
					   "SYS ID:", sys_id,
					   "TABLENAME:", tableName,
					   "Please check your API function call"].join("\n");
			return gs.error(log);
		}
		var gr = new GlideRecord(tableName);
		if(sys_id === "-1"){
		  gr.newRecord();
		  return gr;
		}

		gr.get(sys_id);
		return gr ? gr : gs.error(["No GlideRecord found on table", tableName, "with sys_id", sys_id].join(" "));
	},

	_setFirstIterationParams: function(results, stepGR, recordGR){
		var auto_save = stepGR.guided_workflow_recipe.auto_save_endpoint;
		var url_param = stepGR.guided_workflow_recipe.url_parameter;
		results.record_sys_id = recordGR.getValue("sys_id");
		results.record_table = recordGR.getTableName();
		var data = new GuidedWorkflowData().getData(url_param, recordGR);
		results.data = data ? data : {};

		return results;
	},

	_getStatefulConfigForSteps: function(stepGR, record_sys_id, recordGR){
		var results = {};
		var steps = [];
		var retrieveRecordGR = !recordGR || !recordGR.isValidRecord();
		while(stepGR.next()){
			var stepsLength = steps.length;
			var util = new GuidedWorkflow();
			var config = util.getUIStepDisplay(stepGR, recordGR);
			/* Because table is defined on the config record, and there is no incoming table name,
			 * the stateful nextStep check must wait until it receives a valid recordGR. As such,
			 * on the first iteration of the array, get the underlying recordGR for evaluation
			 */
		    if(stepsLength === 0 && retrieveRecordGR){
				var parentTableForStepsConfig = stepGR.getValue("table");
				recordGR = this._getGR(record_sys_id, parentTableForStepsConfig);
				var nextSteps = new GuidedWorkflow().getAvailableNextStepsWithState(stepGR, recordGR);
				if(recordGR.isNewRecord()){
					recordGR.update();
				}
			    config.availableNextSteps = nextSteps;
				retrieveRecordGR = false;
			}

			if(stepsLength === 0){
				results = this._setFirstIterationParams(results, stepGR, recordGR);
			}

			steps.push(config);
		}

		results.stepsList = steps;
		return results;
	},

	_getStepGRFromURL: function(url_param){
		var stepGR = new GlideRecord(this._workflow_step_table);
		var subQuery = stepGR.addJoinQuery(this._workflow_recipe_table,
											 "guided_workflow_recipe", "sys_id");
		subQuery.addCondition("url_parameter", url_param);
		subQuery.addCondition("default_value", "true");
		stepGR.orderBy("order");
		stepGR.query();
		if(!stepGR.hasNext()){
			var log = "No steps were found on config with default value for url param: " + url_param;
			gs.error(log);
		}

		return stepGR;
	},

	_getConfigSysIdFromExistingRecord: function(gr){
		var recipeGR = new GlideRecord(this._workflow_recipe_table);
		var table = gr.getTableName();
		recipeGR.addQuery("table", table);
		recipeGR.orderBy("order");
		recipeGR.query();
		var util = new GuidedWorkflowEvaluator();
		var match;
		while(!match && recipeGR.next()){
			if(util.matchesCondition(recipeGR, gr)){
			     match = recipeGR.getValue("sys_id");
			}
		}

		return match ? match : gs.error("No matching config found for given GlideRecord " + gr.getTableName() + " " + "with sys_id " + gr.getValue("sys_id"));
	},

	_getStepGRFromKnownRecord: function(gr){
		var stepGR = new GlideRecord(this._workflow_step_table);
		var config_sys_id = this._getConfigSysIdFromExistingRecord(gr);
		stepGR.addQuery("guided_workflow_recipe", config_sys_id);
		stepGR.orderBy("order");
		stepGR.query();
		if(!stepGR.hasNext()){
			var log = "No steps were found on config : " + config_sys_id;
			gs.error(log);
		}

		return stepGR;
	},

	_getStatefulUIConfigURL: function(url_param, gr_sys_id, table){
	  if(!gr_sys_id || !url_param){
		  var log = ["Missing required function args necessary to retrieve guided workflow config",
					 gr_sys_id, url_param].join(" ***** ");
		  gs.error(log);
		  return {};
	  }

	  if(gr_sys_id == "-1"){
		 var stepGR = this._getStepGRFromURL(url_param);
		 return this._getStatefulConfigForSteps(stepGR, gr_sys_id);
	  }

	   // for previously created records, make extra db call when table not included in URL
	  var recordTable = table || this._getTableFromURLConfig(url_param);
	  var params = {record_table: recordTable, record_sys_id: gr_sys_id};
	  return this.getStatefulUIConfigKnownRecord(params);
	},

	getStatefulUIConfigKnownRecord: function(params){
	  var record_sys_id = params.record_sys_id;
	  var record_table = params.record_table;
	  if(!record_sys_id || !record_table){
		  var log = ["Missing attributes on params object which are necessary to retrieve guided workflow config",
					 record_sys_id, record_table].join(" ***** ");
		  gs.error(log);
		  return {};
	  }

	  var gr = this._getGR(record_sys_id, record_table);
	  var stepGR = this._getStepGRFromKnownRecord(gr);
	  return this._getStatefulConfigForSteps(stepGR, record_sys_id, gr);
	},

	getUIConfigJSON: function(url_param){
	  var action = gs.action;
	  var uri = action.getGlideURI();
	  var app_param = uri.get('guide') || url_param;
	  var sys_id = uri.get('sys_id') || "-1";
	  var config = this._getStatefulUIConfigURL(app_param, sys_id) || {};
	  config.url_param = app_param;
	  var encoded = JSON.stringify(config);
	  return encoded;
	},

    type: 'GuidedWorkflowUI'
};
