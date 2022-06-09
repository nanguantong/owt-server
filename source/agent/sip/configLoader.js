// Copyright (C) <2019> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

'use strict';
var fs = require('fs');
var toml = require('toml');
var networkHelper = require('./networkHelper');

module.exports.load = () => {
  var config;
  try {
    config = toml.parse(fs.readFileSync('./agent.toml')) || {};
    config.agent = config.agent || {};
    config.agent.maxProcesses = config.agent.maxProcesses || -1;
    config.agent.prerunProcesses = config.agent.prerunProcesses || 2;

    config.cluster = config.cluster || {};
    config.cluster.name = config.cluster.name || 'owt-cluster';
    config.cluster.worker = config.cluster.worker || {};
    config.cluster.worker.ip = config.cluster.worker.ip || (networkHelper.getAddress("firstEnumerated") || {}).ip || 'unkown';
    config.cluster.worker.join_retry = config.cluster.worker.join_retry || 60;
    config.cluster.worker.load = config.cluster.worker.load || {};
    config.cluster.worker.load.max = config.cluster.max_load || 0.85;
    config.cluster.worker.load.period = config.cluster.report_load_interval || 1000;
    config.cluster.worker.load.item = {
      name: 'cpu'
    };

    config.capacity = config.capacity || {};

    config.internal.ip_address = config.internal.ip_address || '';
    config.internal.network_interface = config.internal.network_interface || undefined;
    config.internal.minport = config.internal.minport || 0;
    config.internal.maxport = config.internal.maxport || 0;

    if (!config.internal.ip_address) {
      let addr = networkHelper.getAddress(config.internal.network_interface || "firstEnumerated");
      if (!addr) {
        console.error("Can't get internal IP address");
        process.exit(1);
      }

      config.internal.ip_address = addr.ip;
    }

    config.sip = config.sip || {};
    config.sip.minport = config.sip.minport || 0;
    config.sip.maxport = config.sip.maxport || 0;
    config.sip.prefer_ipv6 = config.sip.prefer_ipv6 || false;
    config.sip.rtp_timeout = config.sip.rtp_timeout || 0;
    config.sip.mnat = config.sip.mnat || '';

    return config;
  } catch (e) {
    console.error('Parsing config error on line ' + e.line + ', column ' + e.column + ': ' + e.message);
    process.exit(1);
  }

};
