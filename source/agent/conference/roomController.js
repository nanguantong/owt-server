// Copyright (C) <2019> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

'use strict';

var assert = require('assert');
var logger = require('./logger').logger;
var makeRPC = require('./makeRPC').makeRPC;

// Logger
var log = logger.getLogger('RoomController');

function isResolutionEqual(r1, r2) {
  return r1.width && r2.width && r1.height && r2.height && (r1.width === r2.width) && (r1.height === r2.height);
}

const audio_format_obj = function (fmtStr) {
    var fmt_l = fmtStr.split('_'),
        fmt = {codec: fmt_l[0]};
    fmt_l[1] && (fmt.sampleRate = Number(fmt_l[1]));
    fmt_l[2] && (fmt.channelNum = Number(fmt_l[2]));
    return fmt;
};

const video_format_obj = function (fmtStr) {
    var fmt_l = fmtStr.split('_');
    var fmt = { codec: fmt_l[0] };
    fmt_l[1] && (fmt.profile = fmt_l[1]);
    return fmt;
};

const h264ProfileDict = {
  'CB': 1,
  'B': 2,
  'M': 3,
  'H': 4
};

const isVideoProfileCompatible = (curProfile, reqProfile) => {
  let curP = h264ProfileDict[curProfile],
    reqP = h264ProfileDict[reqProfile];

  return !curP || !reqP || (curP <= reqP);
};

const isVideoFmtCompatible = (curFmt, reqFmt) => {
  return (curFmt.codec === reqFmt.codec && isVideoProfileCompatible(curFmt.profile, reqFmt.profile));
};

module.exports.create = function (spec, on_init_ok, on_init_failed) {

    var that = {};

    var cluster = spec.cluster,
        rpcReq = spec.rpcReq,
        rpcClient = spec.rpcClient,
        config = spec.config,
        room_id = spec.room,
        origin = spec.origin,
        selfRpcId = spec.selfRpcId,
        enable_audio_transcoding = config.transcoding && !!config.transcoding.audio,
        enable_video_transcoding = config.transcoding && !!config.transcoding.video,
        internal_conn_protocol = config.internalConnProtocol;

    /*
    mix_views = {
        view: {
            audio: {
                mixer: 'TerminalID',
                supported_formats: ['opus', 'pcmu', 'pcm_raw', ...],
            },
            video: {
                mixer: 'TerminalID',
                supported_formats: {
                    decode: ['h264', 'vp8', 'h265', 'vp9', ...],
                    encode: ['h264', 'vp8', 'h265', 'vp9', ...]
                }
            }
        }
    }
    */
    var mix_views = {};

    /*
    terminals = {terminalID: {owner: ParticipantID | Room's mix stream Id(for amixer and vmixer),
                  type: 'webrtc' | 'streaming' | 'recording' | 'sip' | 'amixer' | 'axcoder' | 'vmixer' | 'vxcoder',
                  locality: {agent: AgentRpcID, node: NodeRpcID},
                  published: [StreamID],
                  subscribed: {SubscriptionID: {audio: StreamID, video: StreamID}}
                 }
    }
    */
    var terminals = {};

    /*
    streams = {StreamID: {owner: terminalID,
                audio: {format: 'pcmu' | 'pcma' | 'isac_16000' | 'isac_32000' | 'opus_48000_2' |...
                        subscribers: [terminalID],
                        status: 'active' | 'inactive' | undefined} | undefined,
                video: {format: 'h264' | 'vp8' |...,
                        resolution: {width: Number(PX), height: Number(PX)} | 'unspecified',
                        framerate: Number(FPS) | 'unspecified',
                        bitrate: Number(Kbps) | 'unspecified',
                        kfi: Number(KeyFrameInterval) | 'unspecified',
                        subscribers: [terminalID],
                        status: 'active' | 'inactive' | undefined} | undefined,
                        simulcast: [{id: simId, resolution: res, ...}],
                spread: [NodeRpcID]
               }
     }
    */
    var streams = {};

    // Schedule preference
    var getMediaPreference = function() {
        var capability = {};
        capability.video = {
            encode: config.mediaOut.video.format.map(formatStr),
            decode: config.mediaIn.video.map(formatStr)
        };
        config.mediaOut.video.format
        config.views.forEach((view) => {
            if (view.video.format) {
                capability.video.encode.push(formatStr(view.video.format));
            }
        });

        return capability;
    };

    var mediaPreference = getMediaPreference();

    // Length 20 number ID generator
    var randomId = function() {
        var length = 20;
        return Math.random().toPrecision(length).toString().substr(2, length);
    };

    // Publish terminal ID generator
    var pubTermId = function(participantId, streamId) {
        return participantId + '-pub-' + streamId;
    };

    // Subscribe terminal ID generator
    var subTermId = function(participantId, subscriptionId) {
        return participantId + '-sub-' + subscriptionId;
    };

    // Given view label, return the mix stream ID
    var getMixStreamOfView = function (viewLabel) {
        if (!mix_views[viewLabel])
            return null;
        return room_id + '-' + viewLabel;
    };

    // Given mix stram ID, return the view
    var getViewOfMixStream = function(mixStreamId) {
        var prefix = room_id + '-';
        if (mixStreamId.indexOf(prefix) != 0) {
            return null;
        }
        var view = mixStreamId.substr(prefix.length);
        return mix_views[view]? view : null;
    };

    var getViewMixingConfig = function(view) {
        var f = config.views.filter((v) => {return v.label === view;});
        if (f.length > 0) {
          return f[0];
        }
        return {};
    };

    var enableAVCoordination = function (view) {
        log.debug('enableAVCoordination');
        var mix_view = mix_views[view];
        if (!mix_view)
            return;

        var view_config = getViewMixingConfig(view);
        if (mix_view.audio.mixer && mix_view.video.mixer && view_config && view_config.audio && view_config.audio.vad) {
            makeRPC(
                rpcClient,
                terminals[mix_view.audio.mixer].locality.node,
                'enableVAD',
                [1000]);
        }
    };

    var resetVAD = function (view) {
        log.debug('resetVAD', view);
        var mix_view = mix_views[view];
        if (!mix_view)
            return;

        var view_config = getViewMixingConfig(view);
        if (mix_view.audio.mixer && mix_view.video.mixer && view_config && view_config.audio && view_config.audio.vad) {
            makeRPC(
                rpcClient,
                terminals[mix_view.audio.mixer].locality.node,
                'resetVAD',
                []);
        }
    };

    var initView = function (view, viewSettings, onInitOk, onInitError) {
        if (!mix_views[view]) {
            onInitError('Mix view does not exist');
            return;
        }

        // Media mixer initializer
        var mixStreamId = getMixStreamOfView(view);
        var initMixer = (mixerId, type, mixConfig) => new Promise(function(resolve, reject) {
            newTerminal(mixerId, type, mixStreamId, false, origin,
                function onTerminalReady() {
                    log.debug('new terminal ok. terminal_id', mixerId, 'type:', type, 'view:', view, 'mixConfig:', mixConfig);
                    initMediaProcessor(mixerId, ['mixing', mixConfig, room_id, selfRpcId, view])
                    .then(function(initMediaResult) {
                        resolve(initMediaResult);
                    }).catch(function(reason) {
                        log.error("Init media processor failed.:", reason);
                        deleteTerminal(mixerId);
                        reject(reason);
                    });
                },
                function onTerminalFail(reason) {
                    log.error('new mix terminal failed. room_id:', room_id, 'reason:', reason);
                    reject(reason);
                }
            );
        });

        // Initialize audio
        var audio_mixer = randomId();
        initMixer(audio_mixer, 'amixer', viewSettings.audio).then(
            function onAudioReady(supportedAudio) {
                // Save supported info
                mix_views[view].audio = {
                    mixer: audio_mixer,
                    supported_formats: supportedAudio.codecs
                };

                if (viewSettings.video) {
                    // Initialize video
                    var video_mixer = randomId();
                    initMixer(video_mixer, 'vmixer', viewSettings.video).then(
                        function onVideoReady(supportedVideo) {
                            // Save supported info
                            mix_views[view].video = {
                                mixer: video_mixer,
                                supported_formats: supportedVideo.codecs
                            };

                            // Enable AV coordination if specified
                            enableAVCoordination(view);
                            onInitOk();
                        },
                        function onVideoFail(reason) {
                            // Delete the audio mixer that init successfully
                            deleteTerminal(audio_mixer);
                            onInitError(reason);
                        }
                    );
                } else {
                    mix_views[view].video = { mixer: null, supported_formats: { encode: [], decode: [] } };
                    onInitOk();
                }
            },
            function onAudioFail(reason) {
                onInitError(reason);
            }
        );
    };

    var initialize = function (on_ok, on_error) {
        log.debug('initialize room', room_id);

        // Mix stream ID is room ID followed by view index
        if (config.views.length > 0) {
                // Mutiple views configuration
                var viewProcessed = [];
                var errorReason;

                config.views.forEach(function(viewSettings) {
                    var viewLabel = viewSettings.label;
                    // Initialize mixer engine for each view
                    mix_views[viewLabel] = {};

                    // Save view init promises
                    viewProcessed.push(new Promise(function(resolve, reject) {
                        initView(viewLabel, viewSettings,
                            function onOk() {
                                log.debug('init ok for view:', viewLabel);
                                resolve(viewLabel);
                            },
                            function onError(reason) {
                                log.error('init fail. view:', viewLabel, 'reason:', reason);
                                errorReason = reason;
                                delete mix_views[viewLabel];
                                resolve(null);
                            });
                    }));
                });

                Promise.all(viewProcessed).then(function(results) {
                    // Result for callback
                    var viewCount = results.filter(function(re) { return re !== null; }).length;
                    if (viewCount < results.length) {
                        log.debug("Views incomplete initialization", viewCount);
                        on_error(errorReason);
                    } else {
                        on_ok(that);
                    }
                }).catch(function(reason) {
                    log.error("Error initialize views:", reason);
                    on_error(reason);
                });
        } else {
            log.debug('Room disable mixing init ok');
            on_ok(that);
        }
    };

    var deinitialize = function () {
        log.debug('deinitialize');

        for (var terminal_id in terminals) {
            var terminal = terminals[terminal_id];
            if (isParticipantTerminal(terminal_id)) {
                terminal.published.map(function (stream_id) {
                    unpublishStream(stream_id);
                });
            } else if (terminal.type === 'amixer' ||
                       terminal.type === 'vmixer' ||
                       terminal.type === 'axcoder' ||
                       terminal.type === 'vxcoder') {
                makeRPC(
                    rpcClient,
                    terminal.locality.node,
                    'deinit',
                    [terminal_id]);
            }
            deleteTerminal(terminal_id);
        }

        mix_views = {};
        terminals = {};
        streams = {};
    };

    var newTerminal = function (terminal_id, terminal_type, owner, preAssignedNode, origin, on_ok, on_error) {
        log.debug('newTerminal:', terminal_id, 'terminal_type:', terminal_type, 'owner:', owner, " origin:", origin);
        if (terminals[terminal_id] === undefined) {
                var purpose = (terminal_type === 'vmixer' || terminal_type === 'vxcoder') ? 'video'
                              : ((terminal_type === 'amixer' || terminal_type === 'axcoder') ? 'audio' : 'unknown');
                mediaPreference.origin = origin;
                var nodeLocality = (preAssignedNode ? Promise.resolve(preAssignedNode)
                                               : rpcReq.getWorkerNode(cluster, purpose, {room: room_id, task: terminal_id}, mediaPreference));

                return nodeLocality
                    .then(function(locality) {
                        terminals[terminal_id] = {
                            owner: owner,
                            origin: origin,
                            type: terminal_type,
                            locality: locality,
                            published: [],
                            subscribed: {}};
                        on_ok();
                    }, function(err) {
                        on_error(err.message? err.message : err);
                    });
        } else {
            on_ok();
        }
    };

    var deleteTerminal = function (terminal_id) {
        log.debug('deleteTerminal:', terminal_id);
        var terminal = terminals[terminal_id];
        if (terminal) {
            if (terminal.type === 'amixer'
                || terminal.type === 'axcoder'
                || terminal.type === 'vmixer'
                || terminal.type === 'vxcoder') {
                rpcReq.recycleWorkerNode(terminal.locality.agent, terminal.locality.node, {room: room_id, task: terminal_id})
                .catch(function(reason) {
                    // Catch the error to avoid the UnhandledPromiseRejectionWarning in node v6,
                    // The current code can reach here due to recycle an already recycled node.
                    // There may be other UnhandledPromiseRejectionWarning somewhere, fix when they appear.
                    log.warn('MediaNode not recycled for:', terminal_id);
                });
            }
            delete terminals[terminal_id];
        }
    };

    var isTerminalFree = function (terminal_id) {
        var terminal = terminals[terminal_id];
        return terminal && terminal.published.length === 0 && (Object.keys(terminal.subscribed).length === 0) ? true : false;
    };

    var isParticipantTerminal = function (terminal_id) {
        var terminal = terminals[terminal_id];
        return terminal && (terminal.type === 'webrtc' || terminal.type === 'streaming' || terminal.type === 'recording' || terminal.type === 'sip');
    };

    var spreadStream = function (stream_id, target_node, target_node_type, on_ok, on_error) {
        log.debug('spreadStream, stream_id:', stream_id, 'target_node:', target_node, 'target_node_type:', target_node_type);

        var stream = streams[stream_id];
        if (!stream || !terminals[stream.owner]) {
            return on_error('Cannot spread a non-existing stream');
        }

        var stream_owner = stream.owner,
            original_node = terminals[stream_owner].locality.node,
            audio = ((stream.audio && target_node_type !== 'vmixer' && target_node_type !== 'vxcoder') ? true : false),
            video = ((stream.video && target_node_type !== 'amixer' && target_node_type !== 'axcoder') ? true : false),
            spread_id = stream_id + '@' + target_node;

        if (!audio && !video) {
            return on_error('Cannot spread stream without audio/video.');
        }

        if (original_node === target_node) {
            log.debug('no need to spread');
            return on_ok();
        } else {
            var i = stream.spread.findIndex((s) => {return s.target === target_node;});
            if (i >= 0) {
              if (stream.spread[i].status === 'connected') {
                log.debug('spread already exists:', spread_id);
                return on_ok();
              } else if (stream.spread[i].status === 'connecting') {
                log.debug('spread is connecting:', spread_id);
                stream.spread[i].waiting.push({onOK: on_ok, onError: on_error});
                return;
              } else {
                log.error('spread status is ambiguous:', spread_id);
                on_error('spread status is ambiguous');
              }
            }
        }
        stream.spread.push({target: target_node, status: 'connecting', waiting: []});

        var on_spread_failed = function(reason, cancel_sub, cancel_pub, cancel_out, cancel_in) {
            log.error('spreadStream failed, stream_id:', stream_id, 'reason:', reason);
            var i = (stream ? stream.spread.findIndex((s) => {return s.target === target_node;}) : -1);
            if (i > -1) {
                stream.spread[i].waiting.forEach((e) => {
                  e.onError(reason);
                });
                stream.spread.splice(i, 1);
            }
            if (cancel_sub) {
                makeRPC(rpcClient, original_node, 'unsubscribe', [spread_id]);
            }

            if (cancel_pub) {
                makeRPC(rpcClient, target_node, 'unpublish', [stream_id]);
            }

            if (cancel_out) {
                makeRPC(rpcClient, original_node, 'destroyInternalConnection', [spread_id, 'out']);
            }

            if (cancel_in) {
                makeRPC(rpcClient, target_node, 'destroyInternalConnection', [stream_id, 'in']);
            }

            on_error(reason);
        };

        // Transport protocol for creating internal connection
        var internalOpt = {
            protocol: internal_conn_protocol
        };
        var from, to, has_published, has_subscribed;

        new Promise(function (resolve, reject) {
            makeRPC(rpcClient, target_node, 'createInternalConnection', [stream_id, 'in', internalOpt], resolve, reject);
        }).then(function(to_addr) {
            to = to_addr;
            return new Promise(function(resolve, reject) {
                makeRPC(rpcClient, original_node, 'createInternalConnection', [spread_id, 'out', internalOpt], resolve, reject);
            });
        }).then(function(from_addr) {
            from = from_addr;
            log.debug('spreadStream:', stream_id, 'from:', from, 'to:', to);

            // Publish/Subscribe internal connections
            return new Promise(function(resolve, reject) {
                if (!terminals[stream_owner]) {
                    reject('Terminal:', stream_owner, 'not exist');
                    return;
                }
                var publisher = (terminals[stream_owner] ? terminals[stream_owner].owner : 'common');
                makeRPC(
                    rpcClient,
                    target_node,
                    'publish',
                    [
                        stream_id,
                        'internal',
                        {
                            controller: selfRpcId,
                            publisher: publisher,
                            audio: (audio ? {codec: stream.audio.format} : false),
                            video: (video ? {codec: stream.video.format} : false),
                            ip: from.ip,
                            port: from.port,
                        }
                    ],
                    resolve,
                    reject
                );
            });
        }).then(function () {
            has_published = true;
            return new Promise(function(resolve, reject) {
                makeRPC(
                    rpcClient,
                    original_node,
                    'subscribe',
                    [
                        spread_id,
                        'internal',
                        {controller: selfRpcId, ip: to.ip, port: to.port}
                    ],
                    resolve,
                    reject
                );
            });
        }).then(function () {
            has_subscribed = true;
            log.debug('internally publish/subscribe ok');

            // Linkup after publish/subscribe ready
            return new Promise(function (resolve, reject) {
                makeRPC(
                    rpcClient,
                    original_node,
                    'linkup',
                    [spread_id, audio ? stream_id : undefined, video ? stream_id : undefined],
                    resolve,
                    reject);
                });
        }).then(function () {
            stream = streams[stream_id];
            if (stream) {
                log.debug('internally linkup ok');
                var i = stream.spread.findIndex((s) => {return s.target === target_node;});
                if (i >= 0) {
                  stream.spread[i].status = 'connected';
                  process.nextTick(() => {
                    stream.spread[i].waiting.forEach((e) => {
                      e.onOK();
                    });
                    stream.spread[i].waiting = [];
                  });
                  on_ok();
                  return Promise.resolve('ok');
                } else {
                  return Promise.reject('spread record missing');
                }
            } else {
                log.error('Stream early released');
                return Promise.reject('Stream early released');
            }
        }).catch(function(err) {
            on_spread_failed(err.message ? err.message : err, has_subscribed, has_published, !!from, !!to);
        });
    };

    var shrinkStream = function (stream_id, target_node) {
        log.debug('shrinkStream, stream_id:', stream_id, 'target_node:', target_node);
        var stream = streams[stream_id], terminal;
        if (stream && (terminal = terminals[stream.owner])) {
            var original_node = terminal.locality.node,
                spread_id = stream_id + '@' + target_node;

            if (original_node !== target_node && !isSpreadInUse(stream_id, target_node)) {
                var i = stream.spread.findIndex((s) => {return s.target === target_node;});
                if (i !== -1) {
                    stream.spread.splice(i, 1);
                }

                makeRPC(
                    rpcClient,
                    original_node,
                    'unsubscribe',
                    [spread_id]);

                makeRPC(
                    rpcClient,
                    target_node,
                    'unpublish',
                    [stream_id]);
            }
        }
    };

    var isSpreadInUse = function (stream_id, node) {
        var stream = streams[stream_id];
        var audio_subscribers = (stream && stream.audio && stream.audio.subscribers) || [],
            video_subscribers = (stream && stream.video && stream.video.subscribers) || [],
            subscribers = audio_subscribers.concat(video_subscribers.filter(function (item) { return audio_subscribers.indexOf(item) < 0;}));

        for (var i in subscribers) {
            var terminal = terminals[subscribers[i]];
            if (terminal && terminal.locality.node === node) {
                return true;
            }
        }

        return false;
    };

    var getSubMediaMixer = function (view, subMedia) {
        var mix_view = mix_views[view];
        if (mix_view && mix_view[subMedia])
            return mix_view[subMedia].mixer;
        return null;
    };

    var mixAudio = function (stream_id, view, on_ok, on_error) {
        log.debug('to mix audio of stream:', stream_id, 'mixed view:', view);
        var audio_mixer = getSubMediaMixer(view, 'audio');
        var stream = streams[stream_id], terminal;
        if (stream && audio_mixer && (terminal = terminals[audio_mixer])) {
            var target_node = terminal.locality.node,
                spread_id = stream_id + '@' + target_node;
            spreadStream(stream_id, target_node, 'amixer', function() {
                stream = streams[stream_id];
                terminal = terminals[audio_mixer];
                if (terminal && stream) {
                    terminal.subscribed[spread_id] = {audio: stream_id};
                    (stream.audio.subscribers.indexOf(audio_mixer) < 0) && stream.audio.subscribers.push(audio_mixer);
                    on_ok();
                    if (stream.audio.status === 'inactive') {
                        makeRPC(
                            rpcClient,
                            target_node,
                            'setInputActive',
                            [stream_id, false]);
                    }
                } else {
                    shrinkStream(stream_id, target_node);
                    on_error('Audio mixer is early released.');
                }
            }, on_error);
        } else {
            log.error('Audio mixer is NOT ready.');
            on_error('Audio mixer is NOT ready.');
        }
    };

    var unmixAudio = function (stream_id, view) {
        log.debug('to unmix audio of view:', view);
        var audio_mixer = getSubMediaMixer(view, 'audio');
        var stream = streams[stream_id], terminal;
        if (stream && stream.audio && audio_mixer && (terminal = terminals[audio_mixer])) {
            var target_node = terminal.locality.node,
                spread_id = stream_id + '@' + target_node,
                i = stream.audio.subscribers.indexOf(audio_mixer);
            delete terminal.subscribed[spread_id];
            if (i > -1) {
                stream.audio.subscribers.splice(i, 1);
                shrinkStream(stream_id, target_node);
            }
        }
    };

    var mixVideo = function (stream_id, view, on_ok, on_error) {
        log.debug('to mix video of stream:', stream_id);
        var video_mixer = getSubMediaMixer(view, 'video');
        var stream = streams[stream_id], terminal;
        if (stream && video_mixer && (terminal = terminals[video_mixer])) {
            var target_node = terminal.locality.node,
                spread_id = stream_id + '@' + target_node;
            spreadStream(stream_id, target_node, 'vmixer', function() {
                stream = streams[stream_id];
                terminal = terminals[video_mixer];
                if (terminal && stream) {
                    terminal.subscribed[spread_id] = {video: stream_id};
                    (stream.video.subscribers.indexOf(video_mixer) < 0) && stream.video.subscribers.push(video_mixer);
                    on_ok();
                    if (stream.video.status === 'inactive') {
                        makeRPC(
                            rpcClient,
                            target_node,
                            'setInputActive',
                            [stream_id, false]);
                    }
                } else {
                    shrinkStream(stream_id, target_node);
                    on_error('Video mixer or input stream is early released.');
                }
            }, on_error);
        } else {
            log.error('Video mixer is NOT ready.');
            on_error('Video mixer is NOT ready.');
        }
    };

    var unmixVideo = function (stream_id, view) {
        log.debug('to unmix video of stream:', stream_id);
        var video_mixer = getSubMediaMixer(view, 'video');
        var stream = streams[stream_id], terminal;
        if (stream && stream.video && video_mixer && (terminal = terminals[video_mixer])) {
            var target_node = terminal.locality.node,
                spread_id = stream_id + '@' + target_node,
                i = stream.video.subscribers.indexOf(video_mixer);
            delete terminal.subscribed[spread_id];
            if (i > -1) {
                stream.video.subscribers.splice(i, 1);
                shrinkStream(stream_id, target_node);
            }
        }
    };

    var mixStream = function (stream_id, view, on_ok, on_error) {
        log.debug('to mix stream:', stream_id, 'view:', view);
        var stream = streams[stream_id];
        if (!stream) {
            log.error('no stream:', stream_id, 'view:', view);
        } else if (stream.audio) {
            mixAudio(stream_id, view, function () {
                if (stream.video && getSubMediaMixer(view, 'video')) {
                    mixVideo(stream_id, view, on_ok, function (error_reason) {
                        unmixAudio(stream_id, view);
                        on_error(error_reason);
                    });
                } else {
                    on_ok();
                }
            }, on_error);
        } else if (stream.video) {
            mixVideo(stream_id, view, on_ok, on_error);
        } else {
            on_error('No audio or video to mix');
        }
    };

    var unmixStream = function (stream_id, view) {
        log.debug('to unmix stream:', stream_id);
        var stream = streams[stream_id];
        if (stream && stream.audio) {
            unmixAudio(stream_id, view);
        }

        if (stream && stream.video) {
            unmixVideo(stream_id, view);
        }
    };

    var spawnMixedAudio = function (view, audio_format, subscriber, on_ok, on_error) {
        var audio_mixer = getSubMediaMixer(view, 'audio');
        if (audio_mixer && terminals[audio_mixer]) {
            var amixer_node = terminals[audio_mixer].locality.node;
            var for_whom = (terminals[subscriber] ? terminals[subscriber].owner : 'common');
            log.debug('spawnMixedAudio, for subscriber:', subscriber, 'for:' , for_whom, 'audio_format:', audio_format);
            makeRPC(
                rpcClient,
                amixer_node,
                'generate',
                [for_whom, audio_format],
                function (stream_id) {
                    log.debug('spawnMixedAudio ok, amixer_node:', amixer_node, 'stream_id:', stream_id);
                    if (terminals[audio_mixer]) {
                        if (streams[stream_id] === undefined) {
                            streams[stream_id] = {
                                owner: audio_mixer,
                                audio: {
                                    format: audio_format,
                                    subscribers: []},
                                video: undefined,
                                spread: []};
                            terminals[audio_mixer].published.push(stream_id);
                        }
                        on_ok(stream_id);
                    } else {
                        on_error('Amixer early released');
                    }
                }, on_error);
        } else {
            on_error('Audio mixer is not ready.');
        }
    };

    var spawnMixedVideo = function (view, format, resolution, framerate, bitrate, keyFrameInterval, on_ok, on_error) {
        var video_mixer = getSubMediaMixer(view, 'video');
        if (video_mixer && terminals[video_mixer]) {
            var vmixer_node = terminals[video_mixer].locality.node;
            log.debug('spawnMixedVideo, view:', view, 'format:', format, 'resolution:', resolution, 'framerate:', framerate, 'bitrate:', bitrate, 'keyFrameInterval:', keyFrameInterval);
            makeRPC(
                rpcClient,
                vmixer_node,
                'generate',
                [format, resolution, framerate, bitrate, keyFrameInterval],
                function (stream) {
                    log.debug('spawnMixedVideo ok, vmixer_node:', vmixer_node, 'stream:', stream);
                    if (terminals[video_mixer]) {
                        if (streams[stream.id] === undefined) {
                            streams[stream.id] = {
                                owner: video_mixer,
                                audio: undefined,
                                video: {
                                    format: format,
                                    resolution: stream.resolution,
                                    framerate: stream.framerate,
                                    bitrate: stream.bitrate,
                                    kfi: stream.keyFrameInterval,
                                    subscribers: []},
                                spread: []};
                            terminals[video_mixer].published.push(stream.id);
                        }
                        on_ok(stream.id);
                    } else {
                        on_error('Vmixer early released');
                    }
                },
                on_error);
        } else {
            on_error('Video mixer is not ready.');
        }
    };

    var getMixedAudio = function (view, audio_format, subscriber, on_ok, on_error) {
        spawnMixedAudio(view,
            audio_format,
            subscriber,
            on_ok,
            on_error);
    };

    var getMixedVideo = function (view, format, resolution, framerate, bitrate, keyFrameInterval, on_ok, on_error) {
        var video_mixer = getSubMediaMixer(view, 'video');
        var candidates = Object.keys(streams).filter(
            function (stream_id) {
                var stream = streams[stream_id];
                return stream.owner === video_mixer &&
                       stream.video &&
                       stream.video.format === format &&
                       isResolutionEqual(stream.video.resolution, resolution) &&
                       stream.video.framerate === framerate &&
                       stream.video.bitrate === bitrate &&
                       stream.video.kfi === keyFrameInterval;
            });
        if (candidates.length > 0) {
            on_ok(candidates[0]);
        } else {
            spawnMixedVideo(view,
                format,
                resolution,
                framerate,
                bitrate,
                keyFrameInterval,
                on_ok,
                on_error);
        }
    };

    var spawnTranscodedAudio = function (axcoder, audio_format, on_ok, on_error) {
        var axcoder_node = terminals[axcoder].locality.node;
        log.debug('spawnTranscodedAudio, audio_format:', audio_format);
        makeRPC(
            rpcClient,
            axcoder_node,
            'generate',
            [audio_format, audio_format],
            function (stream_id) {
                log.debug('spawnTranscodedAudio ok, stream_id:', stream_id);
                if (terminals[axcoder]) {
                    if (streams[stream_id] === undefined) {
                        log.debug('add transcoded stream to streams:', stream_id);
                        streams[stream_id] = {
                            owner: axcoder,
                            audio: {
                                format: audio_format,
                                subscribers: []
                            },
                            video: undefined,
                            spread: []
                        };
                        terminals[axcoder].published.push(stream_id);
                    }
                    on_ok(stream_id);
                } else {
                    makeRPC(
                        rpcClient,
                        axcoder_node,
                        'degenerate',
                        [stream_id]);
                    on_error('Axcoder early released');
                }
            }, on_error);
    };

    var findExistingTranscodedAudio = function (axcoder, audio_format, on_ok, on_error) {
        var published = terminals[axcoder].published;
        for (var j in published) {
            if (streams[published[j]] && streams[published[j]].audio && streams[published[j]].audio.format === audio_format) {
                on_ok(published[j]);
                return;
            }
        }
        on_error();
    };

    var findExistingAudioTranscoder = function (stream_id, on_ok, on_error) {
        var subscribers = streams[stream_id].audio.subscribers;
        for (var i in subscribers) {
            if (terminals[subscribers[i]] && terminals[subscribers[i]].type === 'axcoder') {
                on_ok(subscribers[i]);
                return;
            }
        }
        on_error();
    };

    var getAudioTranscoder = function (stream_id, on_ok, on_error) {
        findExistingAudioTranscoder(stream_id, on_ok, function () {
            var axcoder = randomId();
            var stream = streams[stream_id];
            newTerminal(axcoder, 'axcoder', stream.owner, false, terminals[stream.owner].origin, function () {
                var ax_terminal = terminals[axcoder];
                var on_failed = function (reason) {
                    makeRPC(
                        rpcClient,
                        ax_terminal.locality.node,
                        'deinit',
                        [axcoder]);
                    deleteTerminal(axcoder);
                    on_error(reason);
                };

                makeRPC(
                    rpcClient,
                    ax_terminal.locality.node,
                    'init',
                    ['transcoding', {}, stream_id, selfRpcId, 'transcoder'],
                    function (supported_audio) {
                        var target_node = ax_terminal.locality.node,
                            spread_id = stream_id + '@' + target_node;
                        spreadStream(stream_id, target_node, 'axcoder', function () {
                            ax_terminal = terminals[axcoder];
                            if (ax_terminal) {
                                ax_terminal.subscribed[spread_id] = {audio: stream_id};
                                stream.audio.subscribers.push(axcoder);
                                on_ok(axcoder);
                            } else {
                                shrinkStream(stream_id, target_node);
                                on_failed('Audio transcoder is early released.');
                            }
                        }, on_failed);
                    }, on_error);
            }, on_error);
        });
    };

    var getTranscodedAudio = function (audio_format, stream_id, on_ok, on_error) {
        getAudioTranscoder(stream_id, function (axcoder) {
            findExistingTranscodedAudio(axcoder, audio_format, on_ok, function () {
                spawnTranscodedAudio(axcoder, audio_format, on_ok, on_error);
            });
        }, on_error);
    };

    var spawnTranscodedVideo = function (vxcoder, format, resolution, framerate, bitrate, keyFrameInterval, on_ok, on_error) {
        var vxcoder_node = terminals[vxcoder].locality.node;
        log.debug('spawnTranscodedVideo, format:', format, 'resolution:', resolution, 'framerate:', framerate, 'bitrate:', bitrate, 'keyFrameInterval:', keyFrameInterval);
        makeRPC(
            rpcClient,
            vxcoder_node,
            'generate',
            [format, resolution, framerate, bitrate, keyFrameInterval],
            function (stream) {
                log.debug('spawnTranscodedVideo ok, stream_id:', stream.id);
                if (terminals[vxcoder]) {
                    if (streams[stream.id] === undefined) {
                        log.debug('add to streams.');
                        streams[stream.id] = {
                            owner: vxcoder,
                            audio: undefined,
                            video: {
                                format: format,
                                resolution: stream.resolution,
                                framerate: stream.framerate,
                                bitrate: stream.bitrate,
                                kfi: stream.keyFrameInterval,
                                subscribers: []
                            },
                            spread: []
                        };
                        terminals[vxcoder].published.push(stream.id);
                    }
                    on_ok(stream.id);
                } else {
                    makeRPC(
                        rpcClient,
                        vxcoder_node,
                        'degenerate',
                        [stream.id]);
                    on_error('Vxcoder early released');
                }
            }, on_error);
    };

    var findExistingTranscodedVideo = function (vxcoder, format, resolution, framerate, bitrate, keyFrameInterval, on_ok, on_error) {
        var published = terminals[vxcoder].published;
        for (var j in published) {
            var stream = streams[published[j]];
            if (stream &&
                stream.video &&
                stream.video.format === format &&
                isResolutionEqual(stream.video.resolution, resolution) &&
                stream.video.framerate === framerate &&
                stream.video.bitrate === bitrate &&
                stream.video.kfi === keyFrameInterval) {
                on_ok(published[j]);
                return;
            }
        }
        on_error();
    };

    var findExistingVideoTranscoder = function (stream_id, on_ok, on_error) {
        var subscribers = streams[stream_id].video.subscribers;
        for (var i in subscribers) {
            if (terminals[subscribers[i]] && terminals[subscribers[i]].type === 'vxcoder') {
                on_ok(subscribers[i]);
                return;
            }
        }
        on_error();
    };

    var getVideoTranscoder = function (stream_id, on_ok, on_error) {
        findExistingVideoTranscoder(stream_id, on_ok, function () {
            var vxcoder = randomId();
            var stream = streams[stream_id];
            newTerminal(vxcoder, 'vxcoder', stream.owner, false, terminals[stream.owner].origin, function () {
                var vx_terminal = terminals[vxcoder];
                var on_failed = function (error_reason) {
                    makeRPC(
                        rpcClient,
                        vx_terminal.locality.node,
                        'deinit',
                        [vxcoder]);
                    deleteTerminal(vxcoder);
                    on_error(error_reason);
                };

                makeRPC(
                    rpcClient,
                    vx_terminal.locality.node,
                    'init',
                    ['transcoding', {motionFactor: 1.0}, stream_id, selfRpcId, 'transcoder'],
                    function (supported_video) {
                        var target_node = vx_terminal.locality.node,
                            spread_id = stream_id + '@' + target_node;
                        spreadStream(stream_id, target_node, 'vxcoder', function () {
                            vx_terminal = terminals[vxcoder];
                            if (vx_terminal) {
                                vx_terminal.subscribed[spread_id] = {video: stream_id};
                                stream.video.subscribers.push(vxcoder);
                                on_ok(vxcoder);
                            } else {
                                shrinkStream(stream_id, target_node);
                                on_failed('Video transcoder is early released.');
                            }
                        }, on_failed);
                    }, on_error);
            }, on_error);
        });
    };

    var getTranscodedVideo = function (format, resolution, framerate, bitrate, keyFrameInterval, stream_id, on_ok, on_error) {
        getVideoTranscoder(stream_id, function (vxcoder) {
            findExistingTranscodedVideo(vxcoder, format, resolution, framerate, bitrate, keyFrameInterval, on_ok, function () {
                spawnTranscodedVideo(vxcoder, format, resolution, framerate, bitrate, keyFrameInterval, on_ok, on_error);
            });
        }, on_error);
    };

    var terminateTemporaryStream = function (stream_id) {
        log.debug('terminateTemporaryStream:', stream_id);
        var stream = streams[stream_id];
        var owner = stream.owner;
        var terminal = terminals[owner];
        var node = terminal.locality.node;
        makeRPC(
            rpcClient,
            node,
            'degenerate',
            [stream_id]);
        delete streams[stream_id];

        var i = terminal.published.indexOf(stream_id);
        i > -1 && terminal.published.splice(i, 1);

        if (terminal.published.length === 0 && (terminal.type === 'axcoder' || terminal.type === 'vxcoder')) {
            for (var subscription_id in terminal.subscribed) {
                unsubscribeStream(owner, subscription_id);
            }
            deleteTerminal(owner);
        }
    };

    var recycleTemporaryAudio = function (stream_id) {
        log.debug('trying recycleTemporaryAudio:', stream_id);
        var stream = streams[stream_id];
        if (stream &&
            stream.audio &&
            stream.audio.subscribers.length === 0) {

            var terminal = terminals[stream.owner];
            if (terminal && (terminal.type === 'amixer' || terminal.type === 'axcoder')) {
                terminateTemporaryStream(stream_id);
            }
        }
    };

    var recycleTemporaryVideo = function (stream_id) {
        log.debug('trying recycleTemporaryVideo:', stream_id);
        var stream = streams[stream_id];
        if (stream &&
            stream.video &&
            stream.video.subscribers &&
            stream.video.subscribers.length === 0) {

            var terminal = terminals[stream.owner];
            if (terminal && (terminal.type === 'vmixer' || terminal.type === 'vxcoder')) {
                terminateTemporaryStream(stream_id);
            }
        }
    };

    // This function would be called by getMediaPreference,
    // which is defined before it, so do not declare with the 'var = '
    function formatStr (fmt) {
        var format_str = (fmt.codec || '');
        fmt.sampleRate && (format_str = format_str + '_' + fmt.sampleRate);
        fmt.channelNum && (format_str = format_str + '_' + fmt.channelNum);
        fmt.profile && (format_str = format_str + '_' + fmt.profile);
        return format_str;
    };

    var getMixedFormat = function (subMedia, supportedMixFormats) {
        var format = 'unavailable';
        if (subMedia.format) {
            var format_str = formatStr(subMedia.format);
            if (supportedMixFormats.indexOf(format_str) !== -1) {
                format = format_str;
            }
        } else {
            format = supportedMixFormats[0];
        }
        return format;
    };

    var getForwardFormat = function (subMedia, originalFormat, transcodingEnabled) {
        var format = 'unavailable';
        if (subMedia.format) {
            var format_str = formatStr(subMedia.format);
            if ((format_str === originalFormat) || transcodingEnabled) {
                format = format_str;
            }
        } else {
            format = originalFormat;
        }
        return format;
    };

    var getAudioStream = function (stream_id, audio_format, subscriber, on_ok, on_error) {
        log.debug('getAudioStream, stream:', stream_id, 'audio_format:', audio_format, 'subscriber:', subscriber);
        var stream;
        var mixView = getViewOfMixStream(stream_id);
        if (mixView) {
            getMixedAudio(mixView, audio_format, subscriber, function (streamID) {
                log.debug('Got mixed audio:', streamID);
                on_ok(streamID);
            }, on_error);
        } else if ((stream = streams[stream_id])) {
            if (stream.audio) {
                if (stream.audio.format === audio_format) {
                    on_ok(stream_id);
                } else {
                    getTranscodedAudio(audio_format, stream_id, function (streamID) {
                        on_ok(streamID);
                    }, on_error);
                }
            } else {
                on_error('Stream:'+stream_id+' has no audio track.');
            }
        } else {
            on_error('No such an audio stream:'+stream_id);
        }
    };

    var isVideoMatched = function (videoInfo, format, resolution, framerate, bitrate, keyFrameInterval) {
        if (isVideoFmtCompatible(video_format_obj(videoInfo.format), video_format_obj(format)) &&
            (resolution === 'unspecified' || isResolutionEqual(videoInfo.resolution, resolution)) &&
            (framerate === 'unspecified' || videoInfo.framerate === framerate) &&
            (bitrate === 'unspecified' || videoInfo.bitrate === bitrate) &&
            (keyFrameInterval === 'unspecified' || videoInfo.kfi === keyFrameInterval)) {
            return true;
        }
        return false;
    };

    var simulcastVideoMatched = function (stream_id, format, resolution, framerate, bitrate, keyFrameInterval, simulcastRid) {
        var matchedId;
        var videoInfo = {};
        var stream = streams[stream_id];
        if (stream && stream.video) {
            if (simulcastRid) {
                // Use specified simucalst RID
                if (stream.video.rid === simulcastRid) {
                    return stream_id;
                } else if (stream.video.simulcast) {
                    const selectInfo = stream.video.simulcast[simulcastRid];
                    if (selectInfo && selectInfo.id) {
                        // matched RID
                        return selectInfo.id;
                    }
                } else {
                    matchedId = null;
                }
            } else {
                // Match with parameters
                if (isVideoMatched(stream.video, format, resolution, framerate, bitrate, keyFrameInterval)) {
                    return stream_id;
                } else if (stream.video.simulcast) {
                    for (const rid in stream.video.simulcast) {
                        const simInfo = stream.video.simulcast[rid];
                        const combinedVideo = Object.assign({}, {format: stream.video.format}, simInfo);
                        // TODO: match other parameters after more video info updated for simulcast stream
                        if (isVideoMatched(combinedVideo, format, resolution, 'unspecified', 'unspecified', 'unspecified')) {
                            matchedId = simInfo.id;
                            break;
                        }
                    }
                } else {
                    matchedId = null;
                }
            }
        }
        return matchedId;
    };

    var isSimulcastStream = function (stream_id) {
        return !!streams[stream_id].video.rid;
    };

    var getVideoStream = function (stream_id, format, resolution, framerate, bitrate, keyFrameInterval, simulcastRid, on_ok, on_error) {
        log.debug('getVideoStream, stream:', stream_id, 'format:', format, 'resolution:', resolution, 'framerate:', framerate,
                'bitrate:', bitrate, 'keyFrameInterval', keyFrameInterval, 'simulcastRid', simulcastRid);
        var stream;
        var mixView = getViewOfMixStream(stream_id);
        if (mixView) {
            getMixedVideo(mixView, format, resolution, framerate, bitrate, keyFrameInterval, function (streamID) {
                log.debug('Got mixed video:', streamID);
                on_ok(streamID);
            }, on_error);
        } else if ((stream = streams[stream_id])) {
            if (stream.video) {
                const videoInfo = stream.video;
                if (isSimulcastStream(stream_id)) {
                    const matchedSimId = simulcastVideoMatched(stream_id, format, resolution, framerate, bitrate, keyFrameInterval, simulcastRid);
                    if (matchedSimId) {
                        log.debug('match simulcast stream:', matchedSimId);
                        on_ok(matchedSimId);
                    } else {
                        on_error('Simulcast stream not matched:' + stream_id);
                    }
                } else if (isVideoMatched(videoInfo, format, resolution, framerate, bitrate, keyFrameInterval)) {
                    on_ok(stream_id);
                } else {
                    getTranscodedVideo(format, resolution, framerate, bitrate, keyFrameInterval, stream_id, function (streamID) {
                        on_ok(streamID);
                    }, on_error);
                }
            } else {
                on_error('Stream:'+stream_id+' has no video track.');
            }
        } else {
            on_error('No such a video stream:'+stream_id);
        }
    };

    var unpublishStream = function (stream_id) {
        var stream = streams[stream_id];
        if (stream) {
            log.debug('unpublishStream:', stream_id, 'stream.owner:', stream.owner);
            var terminal = terminals[stream.owner],
                node = terminal.locality.node;

            var i = terminal.published.indexOf(stream_id);
            if (i !== -1) {
                if (config.views.length > 0) {
                    // Unmix on every mix engine
                    for (var view in mix_views) {
                        unmixStream(stream_id, view);
                    }
                }
                removeSubscriptions(stream_id);
                terminal && terminal.published.splice(i, 1);
            }
            stream.close && stream.close();
            delete streams[stream_id];
        } else {
            log.info('try to unpublish an unexisting stream:', stream_id);
        }
    };

    var unsubscribeStream = function (subscriber, subscription_id) {
        var terminal = terminals[subscriber];
        if (terminal) {
            log.debug('unsubscribeStream, subscriber:', subscriber, 'subscription_id:', subscription_id);
            var node = terminal.locality.node,
                subscription = terminal.subscribed[subscription_id],
                audio_stream = subscription && subscription.audio,
                video_stream = subscription && subscription.video;
            var astream, vstream;

            if (isParticipantTerminal(subscriber)) {
                makeRPC(
                    rpcClient,
                    node,
                    'cutoff',
                    [subscription_id]);
            }

            if (audio_stream && (astream = streams[audio_stream])) {
                if (astream.audio) {
                    var i = astream.audio.subscribers.indexOf(subscriber);
                    i > -1 && astream.audio.subscribers.splice(i, 1);
                }
                var terminal = terminals[astream.owner];
                terminal && terminal.locality.node !== node && shrinkStream(audio_stream, node);
                terminal && !isParticipantTerminal(astream.owner) && recycleTemporaryAudio(audio_stream);
            }

            if (video_stream && (vstream = streams[video_stream])) {
                if (vstream.video) {
                    var i = vstream.video.subscribers.indexOf(subscriber);
                    i > -1 && vstream.video.subscribers.splice(i, 1);
                }
                var terminal = terminals[vstream.owner];
                terminal && terminal.locality.node !== node && shrinkStream(video_stream, node);
                terminal && !isParticipantTerminal(vstream.owner) && recycleTemporaryVideo(video_stream);
            }

            delete terminal.subscribed[subscription_id];
        } else {
            log.info('try to unsubscribe to an unexisting terminal:', subscriber);
        }
    };

    var removeSubscriptions = function (stream_id) {
        var stream = streams[stream_id];
        if (stream) {
            if (stream.audio) {
                stream.audio.subscribers.forEach(function(terminal_id) {
                    var terminal = terminals[terminal_id];
                    if (terminal) {
                        for (var subscription_id in terminal.subscribed) {
                            unsubscribeStream(terminal_id, subscription_id);
                            if (terminal.type === 'axcoder') {
                                for (var i in terminal.published) {
                                    unpublishStream(terminal.published[i]);
                                }
                            }
                        }
                        if (isTerminalFree(terminal_id)) {
                            deleteTerminal(terminal_id);
                        }
                    }
                });
                streams[stream_id] && (streams[stream_id].audio.subscribers = []);
            }

            stream = streams[stream_id];
            if (stream && stream.video) {
                stream.video.subscribers.forEach(function(terminal_id) {
                    var terminal = terminals[terminal_id];
                    if (terminal) {
                        for (var subscription_id in terminal.subscribed) {
                            unsubscribeStream(terminal_id, subscription_id);
                            if (terminal.type === 'vxcoder') {
                                for (var i in terminal.published) {
                                    unpublishStream(terminal.published[i]);
                                }
                            }
                        }
                        if (isTerminalFree(terminal_id)) {
                            deleteTerminal(terminal_id);
                        }
                    }
                });
                streams[stream_id] && (streams[stream_id].video.subscribers = []);
            }
        }
    };

    // External interfaces.
    that.destroy = function () {
        deinitialize();
    };

    const rebuildStream = (streamId, accessNode, on_ok, on_error) => {
        log.debug('rebuildStream, streamId:', streamId, 'accessNode:', accessNode.node);

        var stream = streams[streamId];
        var old_st = JSON.parse(JSON.stringify(stream));
        terminals[old_st.owner].locality = accessNode;
        terminals[old_st.owner].subscribers = {};
        stream.spread = [];
        stream.video.subscribers = [];

        return Promise.all(old_st.spread.map(function(target_node) {
            return new Promise(function (res, rej) {
                shrinkStream(streamId, target_node.target);
                setTimeout(() => {
                    spreadStream(streamId, target_node.target, 'participant', function() {
                        res('ok');
                    }, function (reason) {
                        log.warn('Failed in spreading video stream. reason:', reason);
                        rej(reason);
                    });
                }, 20);
            });
        }))
        .then(function () {
            old_st.video.subscribers.forEach(function (t_id) {
                var terminal = terminals[t_id];
                if (terminal) {
                    for (var sub_id in terminal.subscribed) {
                        if (terminal.subscribed[sub_id].video === streamId) {
                            makeRPC(
                                rpcClient,
                                terminal.locality.node,
                                'linkup',
                                [sub_id, undefined, streamId],
                                function () {
                                    log.debug('resumed sub_id:', sub_id, 'for streamId:', streamId);
                                    stream.video.subscribers = stream.video.subscribers || [];
                                    stream.video.subscribers.push(t_id);
                                    terminal.subscribed[sub_id].video = streamId;
                                }, function (reason) {
                                    log.warn('Failed in resuming video subscription:', sub_id, 'reason:', reason);
                                });
                        }
                    }
                }
            });
        })
        .then(function () {
            log.debug('Rebuild stream and its subscriptions ok.');
            on_ok('ok');
        })
        .catch(function (err) {
            log.info('Rebuild stream and or its subscriptions failed. err:', err);
            on_error(err);
        });
    };

    that.publish = function (participantId, streamId, accessNode, streamInfo, streamType, origin, on_ok, on_error) {
        log.debug('publish, participantId: ', participantId, 'streamId:', streamId, 'accessNode:', accessNode.node, 'streamInfo:', JSON.stringify(streamInfo), ' origin is:', origin);
        if (streams[streamId] === undefined) {
            var terminal_id = pubTermId(participantId, streamId);
            var terminal_owner = (streamType === 'webrtc' || streamType === 'sip') ? participantId : room_id + '-' + randomId();
            newTerminal(terminal_id, streamType, terminal_owner, accessNode, origin, function () {
                streams[streamId] = {owner: terminal_id,
                                     audio: streamInfo.audio ? {format: formatStr(streamInfo.audio),
                                                                subscribers: [],
                                                                status: 'active'} : undefined,
                                     video: streamInfo.video ? {format: formatStr(streamInfo.video),
                                                                resolution: streamInfo.video.resolution,
                                                                framerate: streamInfo.video.framerate,
                                                                subscribers: [],
                                                                status: 'active'} : undefined,
                                     spread: []
                                     };
                terminals[terminal_id].published.push(streamId);
                on_ok();
            }, function (error_reason) {
                on_error(error_reason);
            });
        } else if (streamType === 'analytics'){
            rebuildStream(streamId, accessNode, on_ok, on_error);
        } else {
            on_error('Stream[' + streamId + '] already set for ' + participantId);
        }
    };

    that.unpublish = function (participantId, streamId) {
        log.debug('unpublish, stream_id:', streamId);
        var terminal_id = pubTermId(participantId, streamId);
        var stream = streams[streamId];

        if (stream === undefined
            || stream.owner !== terminal_id
            || terminals[terminal_id] === undefined
            || terminals[terminal_id].published.indexOf(streamId) === -1) {
            log.info('unpublish a rogue stream:', streamId);
        }

        unpublishStream(streamId);

        deleteTerminal(terminal_id);
    };

    that.subscribe = function(participantId, subscriptionId, accessNode, subInfo, subType, isAudioPubPermitted, on_ok, on_error) {
        log.debug('subscribe, participantId:', participantId, 'subscriptionId:', subscriptionId, 'accessNode:', accessNode.node, 'subInfo:', JSON.stringify(subInfo), 'subType:', subType);
        if ((!subInfo.audio || (streams[subInfo.audio.from] && streams[subInfo.audio.from].audio) || getViewOfMixStream(subInfo.audio.from))
            && (!subInfo.video || (streams[subInfo.video.from] && streams[subInfo.video.from].video) || getViewOfMixStream(subInfo.video.from))) {

            var audio_format = undefined;
            if (subInfo.audio) {
                var subAudioStream = subInfo.audio.from;
                var subView = getViewOfMixStream(subAudioStream);
                var isMixStream = !!subView;
                audio_format = isMixStream? getMixedFormat(subInfo.audio, mix_views[subView].audio.supported_formats)
                    : getForwardFormat(subInfo.audio, streams[subAudioStream].audio.format, enable_audio_transcoding);

                if (audio_format === 'unavailable') {
                    log.error('No available audio format');
                    log.debug('subInfo.audio:', subInfo.audio, 'targetStream.audio:', streams[subAudioStream] ? streams[subAudioStream].audio : 'mixed_stream', 'enable_audio_transcoding:', enable_audio_transcoding);
                    return on_error('No available audio format');
                }
            }

            var video_format = undefined;
            var resolution = 'unspecified';
            var framerate = 'unspecified';
            var bitrate = 'unspecified';
            var keyFrameInterval = 'unspecified';
            var simulcastRid = undefined;
            if (subInfo.video) {
                var subVideoStream = subInfo.video.from;
                var subView = getViewOfMixStream(subVideoStream);
                var isMixStream = !!subView;

                if (isMixStream) {
                    // Is mix stream
                    video_format = getMixedFormat(subInfo.video, mix_views[subView].video.supported_formats.encode);
                } else {
                    // Is forward stream
                    video_format = getForwardFormat(subInfo.video, streams[subVideoStream].video.format, enable_video_transcoding);
                }

                if (video_format === 'unavailable') {
                    log.error('No available video format');
                    log.debug('subInfo.video:', subInfo.video, 'targetStream.video:', streams[subVideoStream] ? streams[subVideoStream].video : 'mixed_stream', 'enable_video_transcoding:', enable_video_transcoding);
                    return on_error('No available video format');
                }

                subInfo.video && subInfo.video.parameters && subInfo.video.parameters.resolution && (resolution = subInfo.video.parameters.resolution);
                subInfo.video && subInfo.video.parameters && subInfo.video.parameters.framerate && (framerate = subInfo.video.parameters.framerate);
                subInfo.video && subInfo.video.parameters && subInfo.video.parameters.bitrate && (bitrate = subInfo.video.parameters.bitrate);
                subInfo.video && subInfo.video.parameters && subInfo.video.parameters.keyFrameInterval && (keyFrameInterval = subInfo.video.parameters.keyFrameInterval);
            }

            if ((subInfo.audio && !audio_format) || (subInfo.video && !video_format)) {
                log.error('No proper audio/video format');
                return on_error('No proper audio/video format');
            }

            var terminal_id = subTermId(participantId, subscriptionId);

            var finaly_error = function (error_reason) {
                log.error('subscribe failed, reason:', error_reason);
                deleteTerminal(terminal_id);
                on_error(error_reason);
            };

            var finally_ok = function (audioStream, videoStream) {
                return function () {
                    var terminal = terminals[terminal_id], astream, vstream;
                    if (terminal &&
                        (!audioStream || (astream = streams[audioStream])) &&
                        (!videoStream || (vstream = streams[videoStream]))) {
                        log.debug('subscribe ok, audioStream:', audioStream, 'videoStream', videoStream);

                        terminal.subscribed[subscriptionId] = {};
                        if (audioStream) {
                            astream.audio.subscribers = astream.audio.subscribers || [];
                            astream.audio.subscribers.push(terminal_id);
                            terminal.subscribed[subscriptionId].audio = audioStream;
                        }

                        if (videoStream) {
                            vstream.video.subscribers = vstream.video.subscribers || [];
                            vstream.video.subscribers.push(terminal_id);
                            terminal.subscribed[subscriptionId].video = videoStream;
                        }

                        on_ok('ok');

                        //FIXME: It is better to notify subscription connection to request key-frame.
                        if (subInfo.video && (subInfo.video.from !== videoStream)) {
                            forceKeyFrame(videoStream);
                        }
                    } else {
                        audioStream && recycleTemporaryAudio(audioStream);
                        videoStream && recycleTemporaryVideo(videoStream);
                        finaly_error('The subscribed stream has been broken. Canceling it.');
                    }
                };
            };

            var linkup = function (audioStream, videoStream) {
                log.debug('linkup, subscriber:', terminal_id, 'audioStream:', audioStream, 'videoStream:', videoStream);
                if (terminals[terminal_id] && (!audioStream || streams[audioStream]) && (!videoStream || streams[videoStream])) {
                    makeRPC(
                        rpcClient,
                        terminals[terminal_id].locality.node,
                        'linkup',
                        [subscriptionId, audioStream, videoStream],
                        finally_ok(audioStream, videoStream),
                        function (reason) {
                            audioStream && recycleTemporaryAudio(audioStream);
                            videoStream && recycleTemporaryVideo(videoStream);
                            finaly_error(reason);
                        });
                } else {
                    audioStream && recycleTemporaryAudio(audioStream);
                    videoStream && recycleTemporaryVideo(videoStream);
                    finaly_error('participant or streams early left');
                }
            };

            var spread2LocalNode = function (audioStream, videoStream, on_spread_ok, on_spread_error) {
                log.debug('spread2LocalNode, subscriber:', terminal_id, 'audioStream:', audioStream, 'videoStream:', videoStream);
                var terminal = terminals[terminal_id];
                if (terminal && (audioStream !== undefined || videoStream !== undefined)) {
                    var target_node = terminal.locality.node,
                        target_node_type = terminal.type;

                    if (audioStream === videoStream || audioStream === undefined || videoStream === undefined) {
                        var stream_id = (audioStream || videoStream);
                        spreadStream(stream_id, target_node, target_node_type, function () {
                            if (streams[stream_id] && terminal) {
                                on_spread_ok();
                            } else {
                                shrinkStream(stream_id, target_node);
                                on_spread_error('terminal or stream early left.');
                            }
                        }, on_error);
                    } else {
                        log.debug('spread audio and video stream independently.');
                        spreadStream(audioStream, target_node, target_node_type, function () {
                            if (streams[audioStream] && streams[videoStream] && terminal) {
                                log.debug('spread audioStream:', audioStream, ' ok.');
                                spreadStream(videoStream, target_node, target_node_type, function () {
                                    if (streams[audioStream] && streams[videoStream] && terminal) {
                                        log.debug('spread videoStream:', videoStream, ' ok.');
                                        on_spread_ok();
                                    } else {
                                        streams[videoStream] && shrinkStream(videoStream, target_node);
                                        streams[audioStream] && shrinkStream(audioStream, target_node);
                                        on_spread_error('Uncomplished subscription.');
                                    }
                                }, on_spread_error);
                            } else {
                                streams[audioStream] && shrinkStream(audioStream, target_node);
                                on_spread_error('Uncomplished subscription.');
                            }
                        }, on_spread_error);
                    }
                } else {
                    on_spread_error('terminal or stream does not exist.');
                }
            };

            var doSubscribe = function () {
                var audio_stream, video_stream;
                if (subInfo.audio) {
                    log.debug('require audio track of stream:', subInfo.audio.from);
                    getAudioStream(subInfo.audio.from, audio_format, terminal_id, function (streamID) {
                        audio_stream = streamID;
                        log.debug('Got audio stream:', audio_stream);
                        if (subInfo.video) {
                            log.debug('require video track of stream:', subInfo.video.from);
                            getVideoStream(subInfo.video.from, video_format, resolution, framerate, bitrate, keyFrameInterval, subInfo.video.simulcastRid, function (streamID) {
                                video_stream = streamID;
                                log.debug('Got video stream:', video_stream);
                                spread2LocalNode(audio_stream, video_stream, function () {
                                    linkup(audio_stream, video_stream);
                                }, function (error_reason) {
                                    recycleTemporaryVideo(video_stream);
                                    recycleTemporaryAudio(audio_stream);
                                    finaly_error(error_reason);
                                });
                            }, function (error_reason) {
                                recycleTemporaryAudio(audio_stream);
                                finaly_error(error_reason);
                            });
                        } else {
                            spread2LocalNode(audio_stream, undefined, function () {
                                linkup(audio_stream, undefined);
                            }, function (error_reason) {
                                recycleTemporaryAudio(audio_stream);
                                finaly_error(error_reason);
                            });
                        }
                    }, finaly_error);
                } else if (subInfo.video) {
                    log.debug('require video track of stream:', subInfo.video.from);
                    getVideoStream(subInfo.video.from, video_format, resolution, framerate, bitrate, keyFrameInterval, subInfo.video.simulcastRid, function (streamID) {
                        video_stream = streamID;
                        spread2LocalNode(undefined, video_stream, function () {
                            linkup(undefined, video_stream);
                        }, function (error_reason) {
                            recycleTemporaryVideo(video_stream);
                            finaly_error(error_reason);
                        });
                    }, finaly_error);
                } else {
                    log.debug('No audio or video is required.');
                    finaly_error('No audio or video is required.');
                }
            };

            var terminal_owner = (((subType === 'webrtc' || subType === 'sip') && isAudioPubPermitted) ? participantId : room_id);
            newTerminal(terminal_id, subType, terminal_owner, accessNode, subInfo.origin, function () {
                doSubscribe();
            }, on_error);
        } else {
            log.error('streams do not exist or are insufficient. subInfo:', subInfo);
            on_error('streams do not exist or are insufficient');
        }
    };

    that.unsubscribe = function (participant_id, subscription_id) {
        log.debug('unsubscribe from participant:', participant_id, 'for subscription:', subscription_id);
        var terminal_id = subTermId(participant_id, subscription_id);
        if (terminals[terminal_id] && terminals[terminal_id].subscribed[subscription_id]) {
            unsubscribeStream(terminal_id, subscription_id);

            deleteTerminal(terminal_id);
        }
    };

    that.updateStream = function (stream_id, track, status) {
        log.debug('updateStream, stream_id:', stream_id, 'track', track, 'status:', status);
        if ((config.views.length > 0) && (status === 'active' || status === 'inactive')) {
            var stream = streams[stream_id];
            if ((track === 'video' || track === 'av') && stream && stream.video) {
                stream.video.status = status;
                for (var view in mix_views) {
                    var video_mixer = mix_views[view].video.mixer;
                    if (video_mixer && terminals[video_mixer] && (stream.video.subscribers.indexOf(video_mixer) >= 0)) {
                        var target_node = terminals[video_mixer].locality.node;
                        var active = (status === 'active');
                        makeRPC(
                            rpcClient,
                            target_node,
                            'setInputActive',
                            [stream_id, active]);
                    }
                }
            } else if ((track === 'audio' || track === 'av') && stream && stream.audio) {
                stream.audio.status = status;
                for (var view in mix_views) {
                    var audio_mixer = mix_views[view].audio.mixer;
                    if (audio_mixer && terminals[audio_mixer] && (stream.audio.subscribers.indexOf(audio_mixer) >= 0)) {
                        var target_node = terminals[audio_mixer].locality.node;
                        var active = (status === 'active');
                        makeRPC(
                            rpcClient,
                            target_node,
                            'setInputActive',
                            [stream_id, active]);
                    }
                }
            }
        }
    };

    that.mix = function (stream_id, toView, on_ok, on_error) {
        log.debug('mix, stream_id:', stream_id, 'to view:', toView);
        if (!mix_views[toView]) {
            return on_error('Invalid view');
        }
        if (!streams[stream_id]) {
            return on_error('Invalid stream');
        }
        mixStream(stream_id, toView, on_ok, on_error);
    };

    that.unmix = function (stream_id, fromView, on_ok, on_error) {
        log.debug('unmix, stream_id:', stream_id, 'from view:', fromView);
        if (!mix_views[fromView]) {
            return on_error('Invalid view');
        }
        if (!streams[stream_id]) {
            return on_error('Invalid stream');
        }
        unmixStream(stream_id, fromView);
        on_ok();
    };

    that.getRegion = function (stream_id, fromView, on_ok, on_error) {
        log.debug('getRegion, stream_id:', stream_id, 'fromView', fromView);
        var video_mixer = getSubMediaMixer(fromView, 'video');
        if (video_mixer) {
            makeRPC(
                rpcClient,
                terminals[video_mixer].locality.node,
                'getRegion',
                [stream_id],
                on_ok,
                on_error);
        } else {
            on_error('Invalid mix view');
        }
    };

    that.setRegion = function (stream_id, region, toView, on_ok, on_error) {
        log.debug('setRegion, stream_id:', stream_id, 'toView:', toView, 'region:', region);
        var video_mixer = getSubMediaMixer(toView, 'video');
        if (video_mixer) {
            makeRPC(
                rpcClient,
                terminals[video_mixer].locality.node,
                'setRegion',
                [stream_id, region],
                function (data) {
                    on_ok(data);
                    resetVAD(toView);
                }, on_error);
        } else {
            on_error('Invalid mix view');
        }
    };

    that.setLayout = function (toView, layout, on_ok, on_error) {
        log.debug('setLayout, toView:', toView, 'layout:', JSON.stringify(layout));
        var video_mixer = getSubMediaMixer(toView, 'video');
        if (video_mixer) {
            makeRPC(
                rpcClient,
                terminals[video_mixer].locality.node,
                'setLayout',
                [layout],
                function (data) {
                    on_ok(data);
                    resetVAD(toView);
                }, on_error);
        } else {
            on_error('Invalid mix view');
        }
    };

    that.setPrimary = function (inputStreamId, view) {
        log.debug('setPrimary:', inputStreamId, view);
        var video_mixer = getSubMediaMixer(view, 'video');
        var stream = streams[inputStreamId];

        if (stream && stream.video && (stream.video.subscribers.indexOf(video_mixer) !== -1)) {
            makeRPC(
                rpcClient,
                terminals[video_mixer].locality.node,
                'setPrimary',
                [inputStreamId]);
            return;
        }
    };

    that.getMixedStreams = function() {
        if (!mix_views) {
            return [];
        }

        return Object.keys(mix_views).map(function(view) {
            log.debug('mix stream id:', getMixStreamOfView(view));
            return {
                streamId: getMixStreamOfView(view),
                view: view
            };
        });
    };

    that.getMixedStream = function(view) {
        return getMixStreamOfView(view);
    };

    var isImpacted = function (locality, type, id) {
        return (type === 'worker' && locality.agent === id) || (type === 'node' && locality.node === id);
    };

    var allocateMediaProcessingNode  = function (forWhom, usage) {
        return  rpcReq.getWorkerNode(cluster, purpose, {room: room_id, task: terminal_id}, mediaPreference /*FIXME: should take formats and usage specification into preference*/);
    };

    var initMediaProcessor = function (terminal_id, parameters) {
        return new Promise(function (resolve, reject) {
            makeRPC(
                rpcClient,
                terminals[terminal_id].locality.node,
                'init',
                parameters,
                function (result) {
                    resolve(result);
                }, function (error_reason) {
                    reject(error_reason);
                });
        });
    };

    var initVideoMixer = function (vmixerId, view) {
        var videoMixingConfig = getViewMixingConfig(view).video;
        return initMediaProcessor(vmixerId, ['mixing', videoMixingConfig, room_id, selfRpcId, view])
            .then(function (supportedVideo) {
                log.debug('Init video mixer ok. room_id:', room_id, 'vmixer_id:', vmixerId, 'view:', view);
                // Save supported info
                if (mix_views[view]) {
                    mix_views[view].video = {
                        mixer: vmixerId,
                        supported_formats: supportedVideo.codecs
                    };
                }

                // Enable AV coordination if specified
                enableAVCoordination(view);
                return supportedVideo.resolutions;
            }, function (error_reason) {
                log.error('Init video_mixer failed. room_id:', room_id, 'reason:', error_reason);
                Promise.reject(error_reason);
            });
    };


    var forceKeyFrame = function (streamId) {
        if (streams[streamId]) {
            var t_id = streams[streamId].owner;
            if (terminals[t_id]) {
                makeRPC(
                    rpcClient,
                    terminals[t_id].locality.node,
                    'forceKeyFrame',
                    [streamId]);

            }
        }
    };

    var rebuildVideoMixer = function (vmixerId) {
        var old_locality = terminals[vmixerId].locality;
        var inputs = [], outputs = [];
        var view = null;
        for (var vlabel in mix_views) {
            if (mix_views[vlabel].video.mixer === vmixerId) {
                view = vlabel;
                break;
            }
        }

        log.debug('rebuildVideoMixer, vmixerId:', vmixerId, 'view:', view);
        var origin = terminals[vmixerId].origin;
        for (var sub_id in terminals[vmixerId].subscribed) {
            var vst_id = terminals[vmixerId].subscribed[sub_id].video;
            inputs.push(vst_id);
            log.debug('Abort stream mixing:', vst_id);
            unmixVideo(vst_id, view);
        }
        terminals[vmixerId].subscribed = {};

        terminals[vmixerId].published.forEach(function (st_id) {
            if (streams[st_id]) {
                var backup = JSON.parse(JSON.stringify(streams[st_id]));
                backup.old_stream_id = st_id;
                outputs.push(backup);
                streams[st_id].video.subscribers.forEach(function(t_id) {
                    log.debug('Aborting subscription to stream :', st_id, 'by subscriber:', t_id);
                    var i = streams[st_id].video.subscribers.indexOf(t_id);
                    i > -1 && streams[st_id].video.subscribers.splice(i, 1);
                    terminals[t_id] && shrinkStream(st_id, terminals[t_id].locality.node);
                });
                delete streams[st_id];
            }
        });
        terminals[vmixerId].published = [];
        mediaPreference.origin = origin;
        return rpcReq.getWorkerNode(cluster, 'video', {room: room_id, task: vmixerId}, mediaPreference)
            .then(function (locality) {
                log.debug('Got new video mixer node:', locality);
                terminals[vmixerId].locality = locality;
                return initVideoMixer(vmixerId, view);
            })
            .then(function () {
                return Promise.all(inputs.map(function (vst_id) {
                    log.debug('Resuming video mixer input:', vst_id);
                    return new Promise(function (resolve, reject) {
                        mixVideo(vst_id, view, resolve, reject);
                    });
                }));
            })
            .then(function () {
                return Promise.all(outputs.map(function (old_st) {
                    log.debug('Resuming video mixer output:', old_st);
                    return new Promise(function (resolve, reject) {
                        getMixedVideo(view, old_st.video.format, old_st.video.resolution, old_st.video.framerate, old_st.video.bitrate, old_st.video.kfi, function(stream_id) {
                            log.debug('Got new stream:', stream_id);
                            return Promise.all(old_st.spread.map(function(target_node) {
                                return new Promise(function (res, rej) {
                                    spreadStream(stream_id, target_node.target, 'participant', function() {
                                        res('ok');
                                    }, function (reason) {
                                        log.warn('Failed in spreading video stream. reason:', reason);
                                        rej(reason);
                                    });
                                });
                            }))
                            .then(function () {
                                old_st.video.subscribers.forEach(function (t_id) {
                                    var terminal = terminals[t_id];
                                    if (terminal) {
                                        for (var sub_id in terminal.subscribed) {
                                            if (terminal.subscribed[sub_id].video === old_st.old_stream_id) {
                                                makeRPC(
                                                    rpcClient,
                                                    terminal.locality.node,
                                                    'linkup',
                                                    [sub_id, undefined, stream_id],
                                                    function () {
                                                        var stream = streams[stream_id];
                                                        stream.video.subscribers = stream.video.subscribers || [];
                                                        stream.video.subscribers.push(t_id);
                                                        terminal.subscribed[sub_id].video = stream_id;
                                                    }, function (reason) {
                                                        log.warn('Failed in resuming video subscription. reason:', reason);
                                                    });
                                            }
                                        }
                                    }
                                });
                            })
                            .then(function () {
                                log.debug('Resumed video mixer output ok.');
                                forceKeyFrame(stream_id);
                                resolve('ok');
                            })
                            .catch(function (err) {
                                log.info('Resumed video mixer output failed. err:', err);
                                reject(err);
                            });
                        }, reject);
                    });
                }));
            })
            .catch(function (reason) {
                log.error('Rebuid video mixer failed, reason:', (typeof reason === 'string') ? reason : reason.message);
                setTimeout(function () {throw Error('Rebuild video mixer failed.');});
            });
    };

    var rebuildVideoTranscoder = function(vxcoderId) {
        var vx_terminal = terminals[vxcoderId];
        var old_locality = vx_terminal.locality;
        var input, outputs = [];

        log.debug('rebuildVideoTranscoder, vxcoderId:', vxcoderId);
        for (var sub_id in vx_terminal.subscribed) {
            var vst_id = vx_terminal.subscribed[sub_id].video;
            input = vst_id;
            var i = streams[vst_id].video.subscribers.indexOf(vxcoderId);
            i > -1 && streams[vst_id].video.subscribers.splice(i, 1);
            shrinkStream(vst_id, old_locality.node);
        }
        vx_terminal.subscribed = {};

        vx_terminal.published.forEach(function (st_id) {
            var stream = streams[st_id];
            if (stream) {
                var backup = JSON.parse(JSON.stringify(stream));
                backup.old_stream_id = st_id;
                outputs.push(backup);
                stream.video.subscribers.forEach(function(t_id) {
                    log.debug('Aborting subscription to stream :', st_id, 'by subscriber:', t_id);
                    var i = stream.video.subscribers.indexOf(t_id);
                    i > -1 && stream.video.subscribers.splice(i, 1);
                    terminals[t_id] && shrinkStream(st_id, terminals[t_id].locality.node);
                });
                delete streams[st_id];
            }
        });
        vx_terminal.published = [];

        return Promise.resolve('ok')
            .then(function () {
                return Promise.all(outputs.map(function (old_st) {
                    log.debug('Resuming video xcoder output:', old_st);
                    return new Promise(function (resolve, reject) {
                        getTranscodedVideo(old_st.video.format, old_st.video.resolution, old_st.video.framerate, old_st.video.bitrate, old_st.video.kfi, input, function(stream_id) {
                            log.debug('Got new stream:', stream_id);
                            return Promise.all(old_st.spread.map(function(target_node) {
                                return new Promise(function (res, rej) {
                                    spreadStream(stream_id, target_node.target, 'participant', function() {
                                        res('ok');
                                    }, function (reason) {
                                        log.warn('Failed in spreading video stream. reason:', reason);
                                        rej(reason);
                                    });
                                });
                            }))
                            .then(function () {
                                old_st.video.subscribers.forEach(function (t_id) {
                                    var terminal = terminals[t_id];
                                    if (terminal) {
                                        for (var sub_id in terminal.subscribed) {
                                            if (terminal.subscribed[sub_id].video === old_st.old_stream_id) {
                                                makeRPC(
                                                    rpcClient,
                                                    terminal.locality.node,
                                                    'linkup',
                                                    [sub_id, undefined, stream_id],
                                                    function () {
                                                        var stream = streams[stream_id];
                                                        stream.video.subscribers = stream.video.subscribers || [];
                                                        stream.video.subscribers.push(t_id);
                                                        terminal.subscribed[sub_id].video = stream_id;
                                                    }, function (reason) {
                                                        log.warn('Failed in resuming video subscription. reason:', reason);
                                                    });
                                            }
                                        }
                                    }
                                });
                            })
                            .then(function () {
                                log.debug('Resumed video xcoder output ok.');
                                forceKeyFrame(stream_id);
                                resolve('ok');
                            })
                            .catch(function (err) {
                                log.info('Resumed video xcoder output failed. err:', err);
                                reject(err);
                            });
                        }, reject);
                    });
                }));
            })
            .catch(function (reason) {
                log.error('Rebuid video transcoder failed, reason:', (typeof reason === 'string') ? reason : reason.message);
                setTimeout(function () {throw Error('Rebuild video transcoder failed.');});
            });
    };

    var initAudioMixer = function (amixerId, view) {
        var audioMixingConfig = getViewMixingConfig(view).audio;
        return initMediaProcessor(amixerId, ['mixing', audioMixingConfig, room_id, selfRpcId, view])
            .then(function (supportedAudio) {
                log.debug('Init audio mixer ok. room_id:', room_id, 'amixer_id:', amixerId, 'view:', view);
                // Save supported info
                if (mix_views[view]) {
                    mix_views[view].audio = {
                        mixer: amixerId,
                        supported_formats: supportedAudio.codecs
                    };
                }

                // Enable AV coordination if specified
                enableAVCoordination(view);
                return 'ok';
            }, function (error_reason) {
                log.error('Init audio_mixer failed. room_id:', room_id, 'reason:', error_reason);
                Promise.reject(error_reason);
            });
    };

    var rebuildAudioMixer = function (amixerId) {
        var am_terminal = terminals[amixerId];
        var old_locality = am_terminal.locality;
        var inputs = [], outputs = [];
        var view = null;
        for (var vlabel in mix_views) {
            if (mix_views[vlabel].audio.mixer === amixerId) {
                view = vlabel;
                break;
            }
        }

        var origin = am_terminal.origin;
        for (var sub_id in am_terminal.subscribed) {
            var ast_id = am_terminal.subscribed[sub_id].audio;
            inputs.push(ast_id);
            log.debug('Aborting stream mixing:', ast_id);
            unmixAudio(ast_id, view);
        }
        am_terminal.subscribed = {};

        am_terminal.published.forEach(function (st_id) {
            if (streams[st_id]) {
                var backup = JSON.parse(JSON.stringify(streams[st_id]));
                backup.old_stream_id = st_id;
                streams[st_id].audio.subscribers.forEach(function(t_id) {
                    backup.for_whom = t_id;
                    log.debug('Aborting subscription to stream:', st_id, 'by subscriber:', t_id);
                    var i = streams[st_id].audio.subscribers.indexOf(t_id);
                    i > -1 && streams[st_id].audio.subscribers.splice(i, 1);
                    terminals[t_id] && shrinkStream(st_id, terminals[t_id].locality.node);
                });
                outputs.push(backup);
                delete streams[st_id];
            }
        });
        am_terminal.published = [];

        mediaPreference.origin = origin;
        return rpcReq.getWorkerNode(cluster, 'audio', {room: room_id, task: amixerId}, mediaPreference)
            .then(function (locality) {
                log.debug('Got new audio mixer node:', locality);
                am_terminal.locality = locality;
                return initAudioMixer(amixerId, view);
            })
            .then(function () {
                return Promise.all(inputs.map(function (ast_id) {
                    log.debug('Resuming audio mixer input:', ast_id);
                    return new Promise(function (resolve, reject) {
                        mixAudio(ast_id, view, resolve, reject);
                    });
                }));
            })
            .then(function () {
                return Promise.all(outputs.map(function (old_st) {
                    log.debug('Resuming audio mixer output:', old_st, 'view:', view);
                    return new Promise(function (resolve, reject) {
                        getMixedAudio(view, old_st.audio.format, old_st.for_whom, function(stream_id) {
                            log.debug('Got new stream:', stream_id);
                            return Promise.all(old_st.spread.map(function(target_node) {
                                    return new Promise(function (res, rej) {
                                        spreadStream(stream_id, target_node.target, 'participant', function() {
                                            res('ok');
                                        }, function (reason) {
                                            log.warn('Failed in spreading audio stream. reason:', reason);
                                            rej(reason);
                                        });
                                    });
                                }))
                                .then(function () {
                                    old_st.audio.subscribers.forEach(function (t_id) {
                                        var terminal = terminals[t_id];
                                        if (terminal) {
                                            for (var sub_id in terminal.subscribed) {
                                                if (terminal.subscribed[sub_id].audio === old_st.old_stream_id) {
                                                    makeRPC(
                                                        rpcClient,
                                                        terminal.locality.node,
                                                        'linkup',
                                                        [sub_id, stream_id, undefined],
                                                        function () {
                                                            var stream = streams[stream_id];
                                                            stream.audio.subscribers = stream.audio.subscribers || [];
                                                            stream.audio.subscribers.push(t_id);
                                                            terminal.subscribed[sub_id].audio = stream_id;
                                                        }, function (reason) {
                                                            log.warn('Failed in resuming video subscription. reason:', reason);
                                                        });
                                                }
                                            }
                                        }
                                    });
                                })
                                .then(function () {
                                    log.debug('Resumed audio mixer output ok.');
                                    resolve('ok');
                                })
                                .catch(function (err) {
                                    log.info('Resumed audio mixer output failed. err:', err);
                                    reject(err);
                                });
                        }, reject);
                    });
                }));
            })
            .catch(function (reason) {
                log.error('Rebuid audio mixer failed, reason:', (typeof reason === 'string') ? reason : reason.message);
                setTimeout(function () {throw Error('Rebuild audio mixer failed.');});
            });
    };

    var rebuildAudioTranscoder = function(axcoderId) {
        var ax_terminal = terminals[axcoderId];
        var old_locality = ax_terminal.locality;
        var input, outputs = [];

        var origin = ax_terminal.origin;
        for (var sub_id in ax_terminal.subscribed) {
            var vst_id = ax_terminal.subscribed[sub_id].audio;
            input = vst_id;
            var i = streams[vst_id].audio.subscribers.indexOf(axcoderId);
            i > -1 && streams[vst_id].audio.subscribers.splice(i, 1);
            shrinkStream(vst_id, old_locality.node);
        }
        ax_terminal.subscribed = {};

        ax_terminal.published.forEach(function (st_id) {
            if (streams[st_id]) {
                var backup = JSON.parse(JSON.stringify(streams[st_id]));
                backup.old_stream_id = st_id;
                outputs.push(backup);
                streams[st_id].audio.subscribers.forEach(function(t_id) {
                    log.debug('Aborting subscription to stream :', st_id, 'by subscriber:', t_id);
                    var i = streams[st_id].audio.subscribers.indexOf(t_id);
                    i > -1 && streams[st_id].audio.subscribers.splice(i, 1);
                    terminals[t_id] && shrinkStream(st_id, terminals[t_id].locality.node);
                });
                delete streams[st_id];
            }
        });
        ax_terminal.published = [];

        return Promise.resolve('ok')
            .then(function () {
                return Promise.all(outputs.map(function (old_st) {
                    log.debug('Resuming audio xcoder output:', old_st);
                    return new Promise(function (resolve, reject) {
                        getTranscodedAudio(old_st.audio.format, input, function(stream_id) {
                            log.debug('Got new stream:', stream_id);
                            return Promise.all(old_st.spread.map(function(target_node) {
                                return new Promise(function (res, rej) {
                                    spreadStream(stream_id, target_node.target, 'participant', function() {
                                        res('ok');
                                    }, function (reason) {
                                        log.warn('Failed in spreading audio stream. reason:', reason);
                                        rej(reason);
                                    });
                                });
                            }))
                            .then(function () {
                                old_st.audio.subscribers.forEach(function (t_id) {
                                    var terminal = terminals[t_id];
                                    if (terminal) {
                                        for (var sub_id in terminal.subscribed) {
                                            if (terminal.subscribed[sub_id].audio === old_st.old_stream_id) {
                                                makeRPC(
                                                    rpcClient,
                                                    terminal.locality.node,
                                                    'linkup',
                                                    [sub_id, stream_id, undefined],
                                                    function () {
                                                        var stream = streams[stream_id];
                                                        stream.audio.subscribers = stream.audio.subscribers || [];
                                                        stream.audio.subscribers.push(t_id);
                                                        terminal.subscribed[sub_id].audio = stream_id;
                                                    }, function (reason) {
                                                        log.warn('Failed in resuming audio subscription. reason:', reason);
                                                    });
                                            }
                                        }
                                    }
                                });
                            })
                            .then(function () {
                                log.debug('Resumed audio xcoder output ok.');
                                resolve('ok');
                            })
                            .catch(function (err) {
                                log.info('Resumed audio xcoder output failed. err:', err);
                                reject(err);
                            });
                        }, reject);
                    });
                }));
            })
            .catch(function (reason) {
                log.error('Rebuid audio transcoder failed, reason:', (typeof reason === 'string') ? reason : reason.message);
                setTimeout(function () {throw Error('Rebuild audio transcoder failed.');});
            });
    };

    var onVideoFault = function (type, id) {
        for (var terminal_id in terminals) {
            var terminal = terminals[terminal_id];
            if (isImpacted(terminal.locality, type, id)) {
                log.debug('Impacted terminal:', terminal_id, 'and its locality:', terminal.locality);
                if (terminal.type === 'vmixer') {
                    rebuildVideoMixer(terminal_id);
                } else if (terminal.type === 'vxcoder') {
                    rebuildVideoTranscoder(terminal_id);
                }
            }
        }
    };

    var onAudioFault = function (type, id) {
        for (var terminal_id in terminals) {
            var terminal = terminals[terminal_id];
            if (isImpacted(terminal.locality, type, id)) {
                log.debug('Impacted terminal:', terminal_id, 'and its locality:', terminal.locality);
                if (terminal.type === 'amixer') {
                    rebuildAudioMixer(terminal_id);
                } else if (terminal.type === 'axcoder') {
                    rebuildAudioTranscoder(terminal_id);
                }
            }
        }
    };

    that.onFaultDetected = function (purpose, type, id) {
        log.debug('onFaultDetected, purpose:', purpose, 'type:', type, 'id:', id);
        if (purpose === 'video') {
            onVideoFault(type, id);
        } else if (purpose === 'audio') {
            onAudioFault(type, id);
        }
    };

    that.getViewCapability = function (view) {
        var mix_view = mix_views[view];
        if (mix_view) {
            return {
                audio: mix_view.audio.supported_formats.map(audio_format_obj),
                video: {
                    encode: mix_view.video.supported_formats.encode.map(video_format_obj),
                    decode: mix_view.video.supported_formats.decode.map(video_format_obj)
                }
            };
        } else {
            return null;
        }
    };

    that.updateStreamInfo = function (streamId, update) {
        var stream = streams[streamId];
        if (stream) {
            if (update.video && update.video.parameters && update.video.parameters.resolution) {
                stream.video.resolution = update.video.parameters.resolution;
            }
            if (update.rid && stream.video) {
                if (!stream.video.simulcast) {
                    stream.video.simulcast = {};
                }
                if (!stream.video.simulcast[update.rid]) {
                    stream.video.simulcast[update.rid] = {};
                }
                if (update.simId) {
                    stream.video.simulcast[update.rid].id = update.simId;
                    // used for spreading
                    streams[update.simId] = {
                        owner: stream.owner,
                        video: {},
                        simulcastDefault: streamId
                    };
                }
                if (update.info && update.info.video &&
                    update.info.video.parameters &&
                    update.info.video.parameters.resolution) {
                    stream.video.simulcast[update.rid].resolution =
                        update.info.video.parameters.resolution;
                }
                if (!stream.close) {
                    // add a simulcast close function
                    stream.close = () => {
                        for (const rid in stream.video.simulcast) {
                            const simInfo = stream.video.simulcast[rid];
                            delete streams[simInfo.id];
                        }
                    };
                }
            } else if (update.firstrid && stream.video) {
                stream.video.rid = update.firstrid;
            }
            log.debug('updated stream info', JSON.stringify(stream));
        }
    };

    that.drawText = function (streamId, textSpec, duration) {
        var mixView = getViewOfMixStream(streamId);
        var stream, video_processor;
        if (mixView) {
            video_processor = getSubMediaMixer(mixView, 'video');
        } else if ((stream = streams[streamId]) && stream.video) {
            stream.video.subscribers.forEach((t_id) => {
                if (terminals[t_id] && (terminals[t_id].type === 'vxcoder')) {
                    video_processor = t_id;
                }
            });
        } else {
            log.error('Non-existing stream to draw text:', streamId);
        }

        if (video_processor && terminals[video_processor]) {
            makeRPC(
                rpcClient,
                terminals[video_processor].locality.node,
                'drawText',
                [textSpec, duration]);
        } else {
            log.error('No video mixer/transcoder was found for stream:', streamId);
        }
    };

    assert.equal(typeof on_init_ok, 'function');
    assert.equal(typeof on_init_failed, 'function');
    return initialize(on_init_ok, on_init_failed);
};
