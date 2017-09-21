'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.logMigrator = logMigrator;
exports.getMigrator = getMigrator;
exports.ensureCurrentMetaSchema = ensureCurrentMetaSchema;
exports.addTimestampsToSchema = addTimestampsToSchema;

var _index = require('../helpers/index');

var _index2 = _interopRequireDefault(_index);

var _umzug = require('umzug');

var _umzug2 = _interopRequireDefault(_umzug);

var _bluebird = require('bluebird');

var _bluebird2 = _interopRequireDefault(_bluebird);

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var Sequelize = _index2.default.generic.getSequelize();

function logMigrator(s) {
  if (s.indexOf('Executing') !== 0) {
    _index2.default.view.log(s);
  }
}

function getSequelizeInstance() {
  var config = null;

  try {
    config = _index2.default.config.readConfig();
  } catch (e) {
    console.log(e.message);
    process.exit(1);
  }

  config = _lodash2.default.defaults(config, { logging: logMigrator });

  try {
    return new Sequelize(config);
  } catch (e) {
    console.warn(e);
    throw e;
  }
}

function getMigrator(type, args) {
  return _bluebird2.default.try(function () {
    if (!(_index2.default.config.configFileExists() || args.url)) {
      console.log('Cannot find "' + _index2.default.config.getConfigFile() + '". Have you run "sequelize init"?');
      process.exit(1);
    }

    var sequelize = getSequelizeInstance();
    var migrator = new _umzug2.default({
      storage: _index2.default.umzug.getStorage(type),
      storageOptions: _index2.default.umzug.getStorageOptions(type, { sequelize }),
      logging: console.log,
      migrations: {
        params: [sequelize.getQueryInterface(), Sequelize],
        path: _index2.default.path.getPath(type),
        pattern: /\.js$/,
        wrap: function wrap(fun) {
          if (fun.length === 3) {
            return _bluebird2.default.promisify(fun);
          } else {
            return fun;
          }
        }
      }
    });

    return sequelize.authenticate().then(function () {
      return migrator;
    }).catch(function (err) {
      console.error('Unable to connect to database: ' + err);
      process.exit(1);
    });
  });
}

function ensureCurrentMetaSchema(migrator) {
  var queryInterface = migrator.options.storageOptions.sequelize.getQueryInterface();
  var tableName = migrator.options.storageOptions.tableName;
  var columnName = migrator.options.storageOptions.columnName;

  return ensureMetaTable(queryInterface, tableName).then(function (table) {
    var columns = Object.keys(table);

    if (columns.length === 1 && columns[0] === columnName) {
      return;
    } else if (columns.length === 3 && columns.indexOf('createdAt') >= 0) {
      return;
    }
  }).catch(function () {});
}

function ensureMetaTable(queryInterface, tableName) {
  return queryInterface.showAllTables().then(function (tableNames) {
    if (tableNames.indexOf(tableName) === -1) {
      throw new Error('No MetaTable table found.');
    }
    return queryInterface.describeTable(tableName);
  });
}

/**
 * Add timestamps
 *
 * @return {Promise}
 */
function addTimestampsToSchema(migrator) {
  var sequelize = migrator.options.storageOptions.sequelize;
  var queryInterface = sequelize.getQueryInterface();
  var tableName = migrator.options.storageOptions.tableName;

  return ensureMetaTable(queryInterface, tableName).then(function (table) {
    if (table.createdAt) {
      return;
    }

    return ensureCurrentMetaSchema(migrator).then(function () {
      return queryInterface.renameTable(tableName, tableName + 'Backup');
    }).then(function () {
      var sql = queryInterface.QueryGenerator.selectQuery(tableName + 'Backup');
      return _index2.default.generic.execQuery(sequelize, sql, { type: 'SELECT', raw: true });
    }).then(function (result) {
      var SequelizeMeta = sequelize.define(tableName, {
        name: {
          type: Sequelize.STRING,
          allowNull: false,
          unique: true,
          primaryKey: true,
          autoIncrement: false
        }
      }, {
        tableName,
        timestamps: true
      });

      return SequelizeMeta.sync().then(function () {
        return SequelizeMeta.bulkCreate(result);
      });
    });
  });
}