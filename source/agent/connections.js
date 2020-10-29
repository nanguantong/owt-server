// Copyright (C) <2019> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

'use strict';

var logger = require('../logger').logger;
// Logger
var log = logger.getLogger('Connections');

module.exports = function Connections () {
    var that = {},
        /*{ConnectionID: {type: 'webrtc' | 'avstream' | 'recording' | 'internal',
                          direction: 'in' | 'out',
                          audioFrom: ConnectionID | undefined,
                          videoFrom: ConnectionID | undefined,
                          connnection: WebRtcConnection | InternalOut | RTSPConnectionOut
                         }
          }
        */
        connections = {};

    var cutOffFrom = function (connectionId) {
        var conn = connections[connectionId];
        log.debug('remove subscriptions from connection:', connectionId);
        if (conn && conn.direction === 'in') {
            for (var connection_id in connections) {
                var connection = connections[connection_id];
                if (connection.direction === 'out') {
                    if (connection.audioFrom === connectionId) {
                        log.debug('remove audio subscription:', connection.audioFrom);
                        var dest = connection.connection.receiver('audio');
                        if (dest) {
                            conn.connection.removeDestination('audio', dest);
                        }
                        connection.audioFrom = undefined;
                    }

                    if (connection.videoFrom === connectionId) {
                        log.debug('remove video subscription:', connection.videoFrom);
                        var dest = connection.connection.receiver('video');
                        if (dest) {
                            conn.connection.removeDestination('video', dest);
                        }
                        connection.videoFrom = undefined;
                    }
                }
            }
        }
    };

    var cutOffTo = function (connectionId) {
        log.debug('remove subscription to connection:', connectionId);
        var conn = connections[connectionId];
        if (conn && conn.direction === 'out') {
            var audioFrom = conn.audioFrom,
                videoFrom = conn.videoFrom;

            if (audioFrom && connections[audioFrom] && connections[audioFrom].direction === 'in') {
                log.debug('remove audio from:', audioFrom);
                var dest = conn.connection.receiver('audio');
                connections[audioFrom].connection.removeDestination('audio', dest);
                conn.audioFrom = undefined;
            }

            if (videoFrom && connections[videoFrom] && connections[videoFrom].direction === 'in') {
                log.debug('remove video from:', videoFrom);
                var dest = conn.connection.receiver('video');
                connections[videoFrom].connection.removeDestination('video', dest);
                conn.videoFrom = undefined;
            }
        }
    };

    that.addConnection =  function (connectionId, connectionType, connectionController, conn, direction) {
        log.debug('Add connection:', connectionId, connectionType, connectionController);
        if (connections[connectionId]) {
            log.error('Connection already exists:'+connectionId);
            return Promise.reject({type: 'failed', reason: 'Connection already exists:'+connectionId});
        }

        connections[connectionId] = {
            type: connectionType,
            direction: direction,
            audioFrom: undefined,
            videoFrom: undefined,
            connection: conn,
            controller: connectionController
        };

        return Promise.resolve('ok');
    };

    that.removeConnection = function (connectionId) {
        log.debug('Remove connection:', connectionId);
        var conn = connections[connectionId];
        if (conn !== undefined) {
            if (conn.direction === 'in') {
                cutOffFrom(connectionId);
            } else {
                cutOffTo(connectionId);
            }
            delete connections[connectionId];
        } else {
            log.info('Connection does NOT exist:' + connectionId);
            return Promise.reject('Connection does NOT exist:' + connectionId);
        }

        return Promise.resolve('ok');
    };


    that.linkupConnection = function (connectionId, audioFrom, videoFrom) {
        log.debug('linkup, connectionId:', connectionId, ', audioFrom:', audioFrom, ', videoFrom:', videoFrom);
        var conn = connections[connectionId];
        if (!connectionId || !conn) {
            log.error('Subscription does not exist:' + connectionId);
            return Promise.reject('Subscription does not exist:' + connectionId);
        }

        if (audioFrom && connections[audioFrom] === undefined) {
            log.error('Audio stream does not exist:' + audioFrom);
            return Promise.reject({type: 'failed', reason: 'Audio stream does not exist:' + audioFrom});
        }

        if (videoFrom && connections[videoFrom] === undefined) {
            log.error('Video stream does not exist:' + videoFrom);
            return Promise.reject({type: 'failed', reason: 'Video stream does not exist:' + videoFrom});
        }

        if (audioFrom) {
            var dest = conn.connection.receiver('audio');
            if (dest) {
                connections[audioFrom].connection.addDestination('audio', dest);
                conn.audioFrom = audioFrom;
            } else {
                return Promise.reject({type: 'failed', reason: 'Destination connection(audio) is not ready'});
            }
        }

        if (videoFrom) {
            var dest = conn.connection.receiver('video');
            if (dest) {
                connections[videoFrom].connection.addDestination('video', dest);
                conn.videoFrom = videoFrom;
            } else {
                return Promise.reject({type: 'failed', reason: 'Destination connection(video) is not ready'});
            }
        }

        return Promise.resolve('ok');
    };

    that.cutoffConnection = function (connectionId) {
        log.debug('cutoff, connectionId:', connectionId);
        var conn = connections[connectionId];
        if (conn) {
            if (conn.direction === 'in') {
                cutOffFrom(connectionId);
            } else {
                cutOffTo(connectionId);
            }
            return Promise.resolve('ok');
        } else {
            log.debug('Connection does NOT exist:' + connectionId);
            return Promise.reject('Connection does NOT exist:' + connectionId);
        }
    };

    that.getConnection = function (connectionId) {
        return connections[connectionId];
    };

    that.getIds = function () {
        return Object.keys(connections);
    };

    that.onFaultDetected = function (message) {
        if (message.purpose === 'conference') {
            for (var conn_id in connections) {
                var conn = connections[conn_id];
                if ((message.type === 'node' && message.id === conn.controller) || 
                    (message.type === 'worker' && conn.controller.startsWith(message.id))) {
                    log.error('Fault detected on controller (type:', message.type, 'id:', message.id, ') of connection:', conn_id , 'and remove it');
                    that.removeConnection(conn_id);
                }
            }
        }
    };

    return that;
};
