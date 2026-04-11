// Extracted from production dist/index.js
// Original module: server/utils/dbQueryProvider.ts
// Lines: 274

function registerDbQueryProviders(providers) {
  _getAdGroupById = providers.getAdGroupById;
  _getKeywordById = providers.getKeywordById;
  _getProductTargetById = providers.getProductTargetById;
  _getDb = providers.getDb;
  log5.debug("\u6570\u636E\u5E93\u67E5\u8BE2\u63D0\u4F9B\u8005\u5DF2\u6CE8\u518C");
}
function ensureRegistered(fnName) {
  if (!_getAdGroupById || !_getKeywordById || !_getProductTargetById || !_getDb) {
    throw new Error(
      `[dbQueryProvider] ${fnName}: \u6570\u636E\u5E93\u67E5\u8BE2\u63D0\u4F9B\u8005\u5C1A\u672A\u6CE8\u518C\u3002\u8BF7\u786E\u4FDD db.ts \u5DF2\u88AB\u5BFC\u5165\u5E76\u5B8C\u6210\u521D\u59CB\u5316\u3002`
    );
  }
}
async function queryAdGroupById(id) {
  ensureRegistered("queryAdGroupById");
  return _getAdGroupById(id);
}
async function queryKeywordById(id) {
  ensureRegistered("queryKeywordById");
  return _getKeywordById(id);
}
async function queryProductTargetById(id) {
  ensureRegistered("queryProductTargetById");
  return _getProductTargetById(id);
}
async function queryDb() {
  ensureRegistered("queryDb");
  return _getDb();
}
var log5, _getAdGroupById, _getKeywordById, _getProductTargetById, _getDb;
var init_dbQueryProvider = __esm({
  "server/utils/dbQueryProvider.ts"() {
    "use strict";
    init_logger();
    log5 = createModuleLogger("dbQueryProvider");
    _getAdGroupById = null;
    _getKeywordById = null;
    _getProductTargetById = null;
    _getDb = null;
    __name(registerDbQueryProviders, "registerDbQueryProviders");
    __name(ensureRegistered, "ensureRegistered");
    __name(queryAdGroupById, "queryAdGroupById");
    __name(queryKeywordById, "queryKeywordById");
    __name(queryProductTargetById, "queryProductTargetById");
    __name(queryDb, "queryDb");
  }
});

// node_modules/drizzle-orm/mysql-core/alias.js
var init_alias2 = __esm({
  "node_modules/drizzle-orm/mysql-core/alias.js"() {
  }
});

// node_modules/drizzle-orm/mysql-core/columns/index.js
var init_columns = __esm({
  "node_modules/drizzle-orm/mysql-core/columns/index.js"() {
    init_bigint();
    init_binary();
    init_boolean();
    init_char();
    init_common2();
    init_custom();
    init_date();
    init_datetime();
    init_decimal();
    init_double();
    init_enum2();
    init_float();
    init_int();
    init_json();
    init_mediumint();
    init_real();
    init_serial();
    init_smallint();
    init_text();
    init_time();
    init_timestamp();
    init_tinyint();
    init_varbinary();
    init_varchar();
    init_year();
  }
});

// node_modules/drizzle-orm/mysql-core/view.js
function mysqlViewWithSchema(name2, selection, schema) {
  if (selection) {
    return new ManualViewBuilder(name2, selection, schema);
  }
  return new ViewBuilder(name2, schema);
}
var ViewBuilderCore, ViewBuilder, ManualViewBuilder, MySqlView;
var init_view = __esm({
  "node_modules/drizzle-orm/mysql-core/view.js"() {
    init_entity();
    init_selection_proxy();
    init_utils();
    init_query_builder2();
    init_table3();
    init_view_base();
    init_view_common2();
    ViewBuilderCore = class {
      static {
        __name(this, "ViewBuilderCore");
      }
      constructor(name2, schema) {
        this.name = name2;
        this.schema = schema;
      }
      static [entityKind] = "MySqlViewBuilder";
      config = {};
      algorithm(algorithm) {
        this.config.algorithm = algorithm;
        return this;
      }
      sqlSecurity(sqlSecurity) {
        this.config.sqlSecurity = sqlSecurity;
        return this;
      }
      withCheckOption(withCheckOption) {
        this.config.withCheckOption = withCheckOption ?? "cascaded";
        return this;
      }
    };
    ViewBuilder = class extends ViewBuilderCore {
      static {
        __name(this, "ViewBuilder");
      }
      static [entityKind] = "MySqlViewBuilder";
      as(qb) {
        if (typeof qb === "function") {
          qb = qb(new QueryBuilder());
        }
        const selectionProxy = new SelectionProxyHandler({
          alias: this.name,
          sqlBehavior: "error",
          sqlAliasedBehavior: "alias",
          replaceOriginalName: true
        });
        const aliasedSelection = new Proxy(qb.getSelectedFields(), selectionProxy);
        return new Proxy(
          new MySqlView({
            mysqlConfig: this.config,
            config: {
              name: this.name,
              schema: this.schema,
              selectedFields: aliasedSelection,
              query: qb.getSQL().inlineParams()
            }
          }),
          selectionProxy
        );
      }
    };
    ManualViewBuilder = class extends ViewBuilderCore {
      static {
        __name(this, "ManualViewBuilder");
      }
      static [entityKind] = "MySqlManualViewBuilder";
      columns;
      constructor(name2, columns, schema) {
        super(name2, schema);
        this.columns = getTableColumns(mysqlTable(name2, columns));
      }
      existing() {
        return new Proxy(
          new MySqlView({
            mysqlConfig: void 0,
            config: {
              name: this.name,
              schema: this.schema,
              selectedFields: this.columns,
              query: void 0
            }
          }),
          new SelectionProxyHandler({
            alias: this.name,
            sqlBehavior: "error",
            sqlAliasedBehavior: "alias",
            replaceOriginalName: true
          })
        );
      }
      as(query) {
        return new Proxy(
          new MySqlView({
            mysqlConfig: this.config,
            config: {
              name: this.name,
              schema: this.schema,
              selectedFields: this.columns,
              query: query.inlineParams()
            }
          }),
          new SelectionProxyHandler({
            alias: this.name,
            sqlBehavior: "error",
            sqlAliasedBehavior: "alias",
            replaceOriginalName: true
          })
        );
      }
    };
    MySqlView = class extends MySqlViewBase {
      static {
        __name(this, "MySqlView");
      }
      static [entityKind] = "MySqlView";
      [MySqlViewConfig];
      constructor({ mysqlConfig, config: config2 }) {
        super(config2);
        this[MySqlViewConfig] = mysqlConfig;
      }
    };
    __name(mysqlViewWithSchema, "mysqlViewWithSchema");
  }
});

// node_modules/drizzle-orm/mysql-core/schema.js
var MySqlSchema;
var init_schema = __esm({
  "node_modules/drizzle-orm/mysql-core/schema.js"() {
    init_entity();
    init_table3();
    init_view();
    MySqlSchema = class {
      static {
        __name(this, "MySqlSchema");
      }
      constructor(schemaName) {
        this.schemaName = schemaName;
      }
      static [entityKind] = "MySqlSchema";
      table = /* @__PURE__ */ __name((name2, columns, extraConfig) => {
        return mysqlTableWithSchema(name2, columns, extraConfig, this.schemaName);
      }, "table");
      view = /* @__PURE__ */ __name((name2, columns) => {
        return mysqlViewWithSchema(name2, columns, this.schemaName);
      }, "view");
    };
  }
});

// node_modules/drizzle-orm/mysql-core/subquery.js
var init_subquery2 = __esm({
  "node_modules/drizzle-orm/mysql-core/subquery.js"() {
  }
});

// node_modules/drizzle-orm/mysql-core/index.js
var init_mysql_core = __esm({
  "node_modules/drizzle-orm/mysql-core/index.js"() {
    init_alias2();
    init_checks();
    init_columns();
    init_db();
    init_dialect();
    init_foreign_keys2();
    init_indexes();
    init_primary_keys2();
    init_query_builders();
    init_schema();
    init_session();
    init_subquery2();
    init_table3();
    init_unique_constraint2();
    init_utils2();
    init_view_common2();
    init_view();
  }
});

