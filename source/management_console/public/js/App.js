// Copyright (C) <2019> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

'use strict';

const e = React.createElement;
const ReactTable = window.ReactTable.default;
// const restApi = window.restApi;
// const notify = window.notify;
// const notifyConfirm = window.notifyConfirm;

class ServiceApp extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      data: [],
      updates: [],
      pages: null,
      loading: true,
      pageSize: 10,
      createName: '',
      createKey: '',
      createEncrypted: true
    };
    this.fetchData = this.fetchData.bind(this);
    this.renderOperation = this.renderOperation.bind(this);
    this.renderCreator = this.renderCreator.bind(this);
  }

  fetchData(state, instance) {
    this.setState({ loading: true });
    restApi.getServices((err, resp) => {
      if (err) {
        return notify('error', '获取所有服务失败', err);
      }
      const ret = JSON.parse(resp);
      const sortedData = _.orderBy(
        ret,
        state.sorted.map(sort => {
          return row => {
            if (row[sort.id] === null || row[sort.id] === undefined) {
              return -Infinity;
            }
            if (typeof row[sort.id].length === 'number') {
              return row[sort.id].length;
            }
            return typeof row[sort.id] === "string"
              ? row[sort.id].toLowerCase()
              : row[sort.id];
          };
        }),
        state.sorted.map(d => (d.desc ? "desc" : "asc"))
      );

      this.pagination = state;
      const offset = state.pageSize * state.page;
      this.setState({
        data: sortedData.slice(offset, offset + state.pageSize),
        pageSize: state.pageSize,
        pages: Math.ceil(ret.length / state.pageSize),
        loading: false
      });
    });
  }

  renderCreator() {
    return e(
      'div',
      {className: 'input-group form-group', style:{width: '50%'}},
      e(
        'span',
        {className: 'input-group-addon'},
        '名称'
      ),
      e(
        'input',
        {
          type: 'text',
          className: 'form-control',
          value: this.state.createName,
          onChange: (e) => {
            this.setState({createName: e.target.value});
          }
        }
      ),
      e(
        'span',
        {className: 'input-group-addon'},
        '密钥'
      ),
      e(
        'input',
        {
          type: 'text',
          className: 'form-control',
          value: this.state.createKey,
          onChange: (e) => {
            this.setState({createKey: e.target.value});
          }
        }
      ),
      e(
        'span',
        {className: 'input-group-addon'},
        e(
          'input',
          {
            type: 'checkbox',
            checked: this.state.createEncrypted,
            onChange: (e) => {
              this.setState({createEncrypted: e.target.checked});
            }
          }
        ),
        '加密'
      ),
      e(
        'span',
        {className: 'input-group-btn'},
        e(
          'button',
          {
            type: 'button',
            className: 'btn btn-default',
            onClick: (e) => {
              if (this.state.createName === '' || this.state.createKey === '') {
                notify('Warning', '创建服务', '服务名称或者密钥为空');
                return;
              }
              restApi.createService(
                this.state.createName,
                this.state.createKey,
                (err, resp) => {
                  if (err) {
                    return notify('error', '创建服务失败', err);
                  }
                  const ret = JSON.parse(resp);
                  notify('info', '创建服务成功', ret._id);
                  this.fetchData(this.pagination);
                }
              );
            }
          },
          '创建'
        )
      )
    );
  }

  renderOperation(cellInfo) {
    const opService = this.state.data[cellInfo.index];
    return e(
      'div',
      {style: {textAlign: 'center'}},
      e(
        'button',
        {
          className: 'btn btn-sm btn-warning',
          onClick: ()=>{
            notifyConfirm('删除', '是否删除服务 ' + opService._id, ()=>{
              restApi.deleteService(opService._id, (err, resp) => {
                if (err) {
                  return notify('error', '删除服务', resp);
                }
                this.fetchData(this.pagination);
              });
            });
          }
        },
        '删除'
      )
    );
  }

  render() {
    const { data, pages, loading } = this.state;
    const columns = [
      {
        Header: 'ID',
        accessor: '_id'
      },
      {
        Header: '名称',
        accessor: 'name',
      },
      {
        Header: '密钥',
        accessor: 'key',
      },
      {
        id: 'encrypted',
        Header: '加密',
        accessor: d => (!!d.encrypted).toString()
      },
      {
        id: 'rooms',
        Header: '房间数量',
        accessor: d => d.rooms ? d.rooms.length : 0
      },
      {
        Header: '',
        Cell: this.renderOperation
      }
    ];

    const manual = true;
    const onFetchData = this.fetchData;

    return e('div', {},
      e('h1', {className: 'page-header'}, '所有服务'),
      this.renderCreator(),
      e(
        ReactTable,
        {
          data,
          pages,
          loading,
          columns,
          manual: true,
          onFetchData: this.fetchData,
          defaultPageSize: 20
        }
      )
    );
  }
}

class RoomView extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      index: 0,
      create: '',
      layoutArea: null
    };

    this.handleChange = this.handleChange.bind(this);
  }

  handleChange(path, value) {
    this.props.onViewUpdate(this.state.index, path, value);
  }

  renderCheckBox(name, path) {
    const value = _.get(this.props.views[this.state.index], path, true);
    const onCheckChange = () => {
      return (e) => {
        this.handleChange(path, e.target.checked);
      };
    };

    return e(
      'label',
      {className: 'checkbox-inline'},
      e(
        'input',
        {
          type: 'checkbox',
          value: name,
          onChange: onCheckChange(),
          checked: value
        }
      ),
      name
    );
  }

  renderAudio() {
    const view = this.props.views[this.state.index];
    const getAudioName = (fmt) => {
      let name = fmt.codec;
      name = fmt.sampleRate ? name + '-' + fmt.sampleRate : name;
      name = fmt.channelNum ? name + '-' + fmt.channelNum : name;
      return name;
    };
    const selectOptions = this.props.audioOut.map((v, i) => {
      return e('option', {key: i, value: i}, getAudioName(v));
    });
    const audioIndex = this.props.audioOut.findIndex((o) => {
      return _.isEqual(o, _.get(view, 'audio.format'));
    });
    const audioSelect = e(
      'select',
      {
        value: audioIndex || 0,
        onChange: (e) => {
          const index = parseInt(e.target.value);
          const format = _.cloneDeep(this.props.audioOut[index]);
          this.handleChange('audio.format', format);
        },
        className: 'form-control col-sm-3',
        //style: {display: 'inline-block'}
      },
      selectOptions
    );

    return e(
      'div',
      {className: 'panel panel-default'},
      e('div', {className: 'panel-heading'}, '音频配置'),
      e(
        'div',
        {className: 'panel-body'},
        e(
          'div',
          {className: 'container-fluid'},
          e(
            'div',
            {className: 'row form-group'},
            e('div', {className: 'col-sm-3'}, e('label', {}, '格式')),
            e('div', {className: 'col-sm-3'}, audioSelect),
          ),
          e(
            'div',
            {className: 'row form-group'},
            e(
              'div',
              {className: 'col-sm-3'},
              this.renderCheckBox('VAD 使能', 'audio.vad'),
            )
          )
        )
      )
    );
  }

  renderVideo() {
    const view = this.props.views[this.state.index];
    const getVideoName = (fmt) => {
      let name = fmt.codec;
      name = fmt.profile ? name + '-' + fmt.profile : name;
      return name;
    };
    const selectOptions = this.props.videoOut.map((v, i) => {
      return e('option', {key: i, value: i}, getVideoName(v));
    });
    const videoIndex = this.props.videoOut.findIndex((o) => {
      return _.isEqual(o, _.get(view, 'video.format'));
    });
    const videoSelect = e(
      'select',
      {
        value: videoIndex || 0,
        onChange: (e) => {
          const index = parseInt(e.target.value);
          const format = _.cloneDeep(this.props.videoOut[index]);
          this.handleChange('video.format', format);
        },
        className: 'form-control col-sm-3',
        //style: {display: 'inline-block'}
      },
      selectOptions
    );
    const formRow = (label, child) => e(
      'div',
      {className: 'row form-group'},
      e('div', {className: 'col-sm-3'}, e('label', {}, label)),
      e('div', {className: 'col-sm-3'}, child),
    );
    const formInput = (type, path, dValue) => {
      const value = _.get(this.props.views[this.state.index], path, dValue);
      return e('input',
        {
          type,
          value,
          className: 'form-control',
          onChange: (e) => {
            this.handleChange(path, e.target.value);
          },
        },
      );
    };
    const formColor = (path) => {
      let rgb = _.get(this.props.views[this.state.index], path);
      rgb = rgb || {r: 0, g: 0, b: 0};
      const hexVal = (rgb.r << 16) + (rgb.g << 8) + rgb.b;
      const value = '#' + _.padStart(hexVal.toString(16), 6, '0');
      return e('input',
        {
          type: 'color',
          value,
          className: 'form-control',
          onChange: (e) => {
            const colorHex = parseInt(e.target.value.substr(1), 16);
            const r = (colorHex >> 16);
            const g = (colorHex - (r << 16) >> 8);
            const b = (colorHex - (r << 16) - (g << 8));
            const newColor = {r, g, b};
            this.handleChange(path, newColor);
          }
        }
      );
    };
    const formSelect = (options, path) => e(
      'select',
      {
        value: _.get(this.props.views[this.state.index], path, options[0]),
        onChange: (e) => {
          const val = e.target.value;
          this.handleChange(path, val);
        },
        className: 'form-control col-sm-3'
      },
      options.map((v, i) => {
        return e('option', {key: i, value: v}, v);
      })
    );

    const formArea = (path) => {
      const layoutString = JSON.stringify(
        _.get(this.props.views[this.state.index], path, []));
      return e(
        'div',
        {className: 'row form-group'},
        e(
          'div',
          {className: 'col-sm-6'},
          e('label', {}, '自定义布局'),
          e(
            'textarea',
            {
              className: 'form-control',
              resize: 'vertical',
              rows: 10,
              value: (this.state.layoutArea === null ?
                layoutString : this.state.layoutArea),
              onChange: (e) => {
                this.setState({layoutArea: e.target.value});
              }
            }
          ),
          e('button',
            {
              className: 'btn',
              onClick: (e) => {
                try {
                  const layouts = JSON.parse(this.state.layoutArea);
                  this.handleChange(path, layouts);
                } catch (err) {
                  notify('warning', '保存', '格式无效');
                }
              }
            },
            '保存'
          )
        )
      );
    };

    return e(
      'div',
      {className: 'panel panel-default'},
      e('div', {className: 'panel-heading'}, '视频配置'),
      e(
        'div',
        {className: 'panel-body'},
        e(
          'div',
          {className: 'container-fluid'},
          formRow('格式', videoSelect),
          formRow('宽',
            formInput('text', 'video.parameters.resolution.width', 640)),
          formRow('高',
            formInput('text', 'video.parameters.resolution.height', 480)),
          formRow('帧率',
            formInput('text', 'video.parameters.framerate', 24)),
          formRow('码率',
            formInput('text', 'video.parameters.bitrate', 0)),
          formRow('关键帧间隔',
            formInput('text', 'video.parameters.keyFrameInterval', 100)),
          formRow('背景颜色',
            formColor('video.bgColor')),
          formRow('房间最大输入数',
            formInput('number', 'video.maxInput', 8)),
          formRow('视频运动阈值',
            formInput('number', 'video.motionFactor', 0.6)),
          e(
            'div',
            {className: 'row form-group'},
            e(
              'div',
              {className: 'col-sm-3'},
              this.renderCheckBox('保持活动输入', 'video.keepActiveInputPrimary'),
            )
          ),
          formRow('布局策略',
            formSelect(['letterbox', 'crop'], 'video.layout.fitPolicy')),
          formRow('布局基础模板',
            formSelect(['fluid', 'lecture', 'void'], 'video.layout.templates.base')),
          formArea('video.layout.templates.custom')
        )
      )
    );
  }

  render() {
    const views = this.props.views || [];
    const selectOptions = views.map((v, i) => {
      return e('option', {key: i, value: i}, views[i].label);
    });
    const viewSelect = e(
      'select',
      {
        value: this.state.index,
        onChange: (e) => {
          const newIndex = parseInt(e.target.value);
          this.setState({index: newIndex, layoutArea: null});
        },
        className: 'form-control',
        style: {display: 'inline-block'}
      },
      selectOptions
    );
    const createInput = e(
      'input',
      {
        className: 'form-control',
        placeholder: '请输入',
        type: 'text',
        onChange: (e) => {
          this.setState({create: e.target.value});
        }
      }
    );
    const createButton = e(
      'button',
      {
        className: 'btn btn-default',
        type: 'button',
        onClick: (e)=> {
          this.props.onViewCreate({label: this.state.create});
        }
      },
      '创建视图'
    );
    const removeButton = e(
      'button',
      {
        className: 'btn',
        onClick: (e) => {
          if (this.state.index >= 0) {
            this.props.onViewRemove(this.state.index);
          }
        }
      },
      '删除'
    );

    return e(
      'div',
      {className: 'panel panel-default'},
      e('div', {className: 'panel-heading'}, '视图'),
      e(
        'div',
        {className: 'panel-body'},
        e(
          'div',
          {className: 'container-fluid'},
          e(
            'div',
            {className: 'row form-group'},
            e('div', {className: 'col-sm-3'}, viewSelect),
            e(
              'div',
              {className: 'col-sm-4'},
              e(
                'div',
                {className: 'input-group'},
                createInput,
                e('span', {className: 'input-group-btn'}, createButton)
              )
            ),
            e('div', {className: 'col-sm-3'}, removeButton),
          ),
          this.renderAudio(),
          this.renderVideo(),
        )
      )
    );
  }
}

class RoomModal extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      room: _.cloneDeep(props.data)
    };
    this.handleChange = this.handleChange.bind(this);
    this.onViewUpdate = this.onViewUpdate.bind(this);
    this.onViewCreate = this.onViewCreate.bind(this);
    this.onViewRemove = this.onViewRemove.bind(this);

    this.renderMediaCheckBox = this.renderMediaCheckBox.bind(this);

    this.mediaFormat = {
      // video
      'h264': {codec: 'h264'},
      'h264-constrained-baseline': {codec: 'h264', profile: 'CB'},
      'h264-baseline': {codec: 'h264', profile: 'B'},
      'h264-main': {codec: 'h264', profile: 'M'},
      'h264-high': {codec: 'h264', profile: 'H'},
      'h265': {codec: 'h265'},
      'vp8': {codec: 'vp8'},
      'vp9': {codec: 'vp9'},
      'av1': {codec: 'av1'}, //for chrome95+
      'av1x': {codec: 'av1x'},
      // audio
      'opus': {codec: 'opus', sampleRate: 48000, channelNum: 2},
      'isac-16000': {codec: 'isac', sampleRate: 16000},
      'isac-32000': {codec: 'isac', sampleRate: 32000},
      'g722-16000-1': {codec: 'g722', sampleRate: 16000, channelNum: 1},
      'pcma': {codec: 'pcma'},
      'pcmu': {codec: 'pcmu'},
      'aac': {codec: 'aac'},
      'aac-48000-2': {codec: 'aac', sampleRate: 48000, channelNum: 2},
      'ac3': {codec: 'ac3'},
      'nellymoser': {codec: 'nellymoser'},
      'ilbc': {codec: 'ilbc'},
    };
  };

  onViewUpdate(vIndex, path, value) {
    let newRoom = _.cloneDeep(this.state.room);
    if (newRoom.views) {
      _.set(newRoom.views[vIndex], path, value);
      this.setState({room: newRoom});
    }
  }

  onViewCreate(value) {
    let newRoom = _.cloneDeep(this.state.room);
    newRoom.views = newRoom.views || [];
    newRoom.views.push(value);
    this.setState({room: newRoom});
  }

  onViewRemove(vIndex) {
    let newRoom = _.cloneDeep(this.state.room);
    if (newRoom.views) {
      newRoom.views.splice(vIndex, 1);
      this.setState({room: newRoom});
    }
  }

  onSipUpdate = (path, value) => {
    let newRoom = _.cloneDeep(this.state.room);
    if (!newRoom.sip) {
      newRoom.sip = {sipServer: '', username: '', password: '', transport: ''};
    }
    newRoom.sip[path] = value;
    this.setState({room: newRoom});
  };

  handleChange(e) {
    // validate
    this.props.onRoomUpdate(this.props.index, this.state.room);
  }

  renderMediaCheckBox(name, path) {
    const value = this.mediaFormat[name] || name;
    const list = _.get(this.state.room, path) || [];

    const hasMediaFormat = () => {
      if (list.find((e) => _.isEqual(value, e))) {
        return true;
      }
      return false;
    };
    const onMediaChange = () => {
      return (e) => {
        if (e.target.checked) {
          const newValue = [...list, value];
          let newState = _.cloneDeep(this.state.room);
          _.set(newState, path, newValue);
          this.setState({room: newState});
        } else {
          const newValue = list.filter((e) => !_.isEqual(value, e));
          let newState = _.cloneDeep(this.state.room);
          _.set(newState, path, newValue);
          this.setState({room: newState});
        }
      };
    };

    return e(
      'label',
      {className: 'checkbox-inline'},
      e(
        'input',
        {
          type: 'checkbox',
          value: name,
          onChange: onMediaChange(),
          defaultChecked: hasMediaFormat()
        }
      ),
      name
    );
  }

  renderMediaIn() {
    const room = this.state.room;
    const mediaCheckBox = this.renderMediaCheckBox.bind(this);

    const audioNames = [
      'opus', 'isac-16000', 'isac-32000',
      'g722-16000-1', 'pcmu', 'pcma',
      'aac', 'ac3', 'nellymoser', 'libc',
    ];
    const audioCheckBoxes = audioNames.map((name) => {
      return mediaCheckBox(name, 'mediaIn.audio');
    });

    const videoNames = ['h264', 'h265', 'vp8', 'vp9','av1','av1x'];
    const videoCheckBoxes = videoNames.map((name) => {
      return mediaCheckBox(name, 'mediaIn.video');
    });

    return e(
      'div',
      {className: 'panel panel-default'},
      e('div', {className: 'panel-heading'}, '媒体输入'),
      e(
        'div',
        {className: 'panel-body'},
        e(
          'div',
          {className: 'form-group'},
          e('label', {className: 'col-sm-1 control-label'}, '音频'),
          ...audioCheckBoxes
        ),
        e(
          'div',
          {className: 'form-group'},
          e('label', {className: 'col-sm-1 control-label'}, '视频'),
          ...videoCheckBoxes
        )
      )
    );
  }

  renderMediaOut() {
    const room = this.state.room;
    const mediaCheckBox = this.renderMediaCheckBox.bind(this);

    const audioNames = [
      'opus', 'isac-16000', 'isac-32000',
      'g722-16000-1', 'pcmu', 'pcma',
      'aac-48000-2', 'ac3', 'nellymoser', 'libc',
    ];
    const audioCheckBoxes = audioNames.map((name) => {
      return mediaCheckBox(name, 'mediaOut.audio');
    });

    const videoNames = [
      'h264-constrained-baseline',
      'h264-baseline',
      'h264-main',
      'h264-high',
      'h265', 'vp8', 'vp9', 'av1x',
    ];
    const videoCheckBoxes = videoNames.map((name) => {
      return mediaCheckBox(name, 'mediaOut.video.format');
    });

    const resolutions = [
      'x3/4', 'x2/3', 'x1/2', 'x1/3', 'x1/4',
      'hd1080p', 'hd720p', 'svga', 'vga', 'qvga', 'cif'
    ];
    const resolutionBoxes = resolutions.map((name) => {
      return mediaCheckBox(name, 'mediaOut.video.parameters.resolution');
    });
    const framerates = [6, 12, 15, 24, 30, 48, 60];
    const framerateBoxes = framerates.map((name) => {
      return mediaCheckBox(name, 'mediaOut.video.parameters.framerate');
    });
    const bitrates = ['x0.8', 'x0.6', 'x0.4', 'x0.2'];
    const bitrateBoxes = bitrates.map((name) => {
      return mediaCheckBox(name, 'mediaOut.video.parameters.bitrate');
    });
    const kfis = [100, 30, 5, 2, 1];
    const kfiBoxes = kfis.map((name) => {
      return mediaCheckBox(name, 'mediaOut.video.parameters.keyFrameInterval');
    });

    return e(
      'div',
      {className: 'panel panel-default'},
      e('div', {className: 'panel-heading'}, '媒体输出'),
      e(
        'div',
        {className: 'panel-body'},
        e(
          'div',
          {className: 'form-group'},
          e('label', {className: 'col-sm-1 control-label'}, '音频'),
          ...audioCheckBoxes
        ),
        e(
          'div',
          {className: 'form-group'},
          e('label', {className: 'col-sm-1 control-label'}, '视频'),
          ...videoCheckBoxes
        ),
        e(
          'div',
          {className: 'panel panel-default'},
          e('div', {className: 'panel-heading'}, '视频参数'),
          e(
            'div',
            {className: 'panel-body'},
            e(
              'div',
              {className: 'form-group'},
              e('label', {style: {display: 'block'}}, '分辨率'),
              ...resolutionBoxes
            ),
            e(
              'div',
              {className: 'form-group'},
              e('label', {style: {display: 'block'}}, '帧率'),
              ...framerateBoxes
            ),
            e(
              'div',
              {className: 'form-group'},
              e('label', {style: {display: 'block'}}, '码率'),
              ...bitrateBoxes
            ),
            e(
              'div',
              {className: 'form-group'},
              e('label', {style: {display: 'block'}}, '关键帧间隔'),
              ...kfiBoxes
            )
          )
        )
      )
    );
  }

  renderSip() {
    const room = this.state.room;

    const sipRow = (label, child) => e(
      'div',
      {className: 'row form-group'},
      e('div', {className: 'col-sm-3'}, e('label', {}, label)),
      e('div', {className: 'col-sm-3'}, child),
    );
    const sipInput = (type, path, dValue) => {
      const value = _.get(this.state.room.sip, path, dValue);
      return e('input',
        {
          type: type,
          value,
          className: 'form-control',
          onChange: (e) => {
            this.onSipUpdate(path, e.target.value);
          },
        },
      );
    };
    const sipSelect = (options, path) => e(
      'select',
      {
        value: _.get(room.sip, path, options[0]),
        onChange: (e) => {
          const val = e.target.value;
          this.onSipUpdate(path, val);
        },
        className: 'form-control col-sm-3'
      },
      options.map((v, i) => {
        return e('option', {key: i, value: v}, v);
      })
    );

    return e(
      'div',
      {className: 'panel panel-default'},
      e('div', {className: 'panel-heading'}, 'SIP'),
      e(
        'div',
        {className: 'panel-body'},
        e(
          'div',
          {className: 'container-fluid'},

          sipRow('sip服务',
            sipInput('text', 'sipServer', '')),
          sipRow('用户名',
            sipInput('text', 'username', '')),
          sipRow('密码',
            sipInput('password', 'password', '')),
          sipRow('信令传输协议',
            sipSelect(['udp', 'tcp', 'tls'], 'transport'))
        ),
      )
    );
  }

  renderNotifying() {
    const room = this.state.room;
    const notifyRow = (path, name) => {
      const value = _.get(this.state.room.notifying, path, '');
      return e(
        'div',
        {className: 'row form-group'},
        e('div', {className: 'col-sm-3'}, e('label', {}, name)),
        e(
          'div',
          {className: 'col-sm-3'},
          e('label',
            {className: 'checkbox-inline'},
            e(
              'input',
              {
                type: 'checkbox',
                value: path,
                onChange: (e) => {
                  let newRoom = _.cloneDeep(this.state.room);
                  if (!newRoom.notifying) {
                    newRoom.notifying = {
                      streamChange: true,
                      participantActivities: true
                    };
                  }
                  newRoom.notifying[path] = e.target.checked;
                  this.setState({room: newRoom});
                },
                checked: value
              }
            ),
          )
        ),
      );
    };

    return e(
      'div',
      {className: 'panel panel-default'},
      e('div', {className: 'panel-heading'}, '通知'),
      e(
        'div',
        {className: 'panel-body'},
        e(
          'div',
          {className: 'container-fluid'},
          notifyRow('streamChange', '流改变'),
          notifyRow('participantActivities', '参与者活动'),
        ),
      )
    );
  }

  renderTranscoding() {
    const room = this.state.room;
    const transcodingRow = (path, name) => {
      const value = _.get(this.state.room.transcoding, path, false);
      return e(
        'div',
        {className: 'row form-group'},
        e('div', {className: 'col-sm-3'}, e('label', {}, name)),
        e(
          'div',
          {className: 'col-sm-3'},
          e('label',
            {className: 'checkbox-inline'},
            e(
              'input',
              {
                type: 'checkbox',
                value: name,
                onChange: (e) => {
                  let newRoom = _.cloneDeep(this.state.room);
                  if (!newRoom.transcoding) {
                    newRoom.transcoding = {};
                  }
                  _.set(newRoom.transcoding, path, e.target.checked);
                  this.setState({room: newRoom});
                },
                checked: value
              }
            ),
          )
        ),
      );
    };

    return e(
      'div',
      {className: 'panel panel-default'},
      e('div', {className: 'panel-heading'}, '转码'),
      e(
        'div',
        {className: 'panel-body'},
        e(
          'div',
          {className: 'container-fluid'},
          transcodingRow('audio', '音频格式'),
          transcodingRow('video.format', '视频格式'),
          transcodingRow('video.parameters.resolution', '视频分辨率'),
          transcodingRow('video.parameters.framerate', '视频帧率'),
          transcodingRow('video.parameters.bitrate', '视频码率'),
          transcodingRow('video.parameters.keyFrameInterval', '视频关键帧间隔'),
        ),
      )
    );
  }

  renderActiveAudioSelecting() {
    return e(
      'div',
      {className: 'panel panel-default'},
      e('div', {className: 'panel-heading'}, '转发'),
      e(
        'div',
        {className: 'panel-body'},
        e(
          'label',
          {className: 'checkbox-inline'},
          e(
          'input',
            {
              type: 'checkbox',
              onChange: (e) => {
                let newRoom = _.cloneDeep(this.state.room);
                newRoom.selectActiveAudio = e.target.checked;
                this.setState({room: newRoom});
              },
              checked: this.state.room.selectActiveAudio
            }
          ),
          '选择活动音频',
        ),
      ),
    );
  }

  render() {
    return e(
      'div',
      {
        className: 'modal-dialog modal-lg',
        role: 'document'
      },
      e(
        'div',
        {className: 'modal-content'},
        e(
          'div',
          {className: 'modal-header'},
          e(
            'button',
            {
              type: 'button',
              className: 'close',
              'data-dismiss': 'modal',
              'aria-label': '关闭'
            },
            e('span', {'aria-hidden': true}, 'x')
          ),
          e('h4', {className: 'modal-title'}, '房间: ' + this.state.room._id)
        ),
        e(
          'div',
          {className: 'modal-body'},
          this.renderMediaIn(),
          this.renderMediaOut(),
          this.renderSip(),
          this.renderTranscoding(),
          this.renderNotifying(),
          this.renderActiveAudioSelecting(),
          e(
            RoomView,
            {
              views: this.state.room.views || [],
              audioOut: _.get(this.state.room, 'mediaOut.audio', []),
              videoOut: _.get(this.state.room, 'mediaOut.video.format', []),
              onViewUpdate: this.onViewUpdate,
              onViewCreate: this.onViewCreate,
              onViewRemove: this.onViewRemove
            }
          ),
        ),
        e(
          'div',
          {className: 'modal-footer'},
          e(
            'button',
            {
              type: 'button',
              className: 'btn btn-primary',
              'data-dismiss': 'modal',
              onClick: this.handleChange
            },
            e('i', {className: 'glyphicon glyphicon-ok'})
          ),
          e(
            'button',
            {
              type: 'button',
              className: 'btn btn-default',
              'data-dismiss': 'modal'
            },
            e('i', {className: 'glyphicon glyphicon-remove'})
          )
        )
      )
    );
  }
}


class RoomApp extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      data: [],
      updates: [],
      pages: null,
      loading: true,
      pageSize: 10
    };
    this.modalId = this.props.modalId || 'RoomModal';
    this.roomCount = this.props.count;
    this.fetchData = this.fetchData.bind(this);
    this.renderEditable = this.renderEditable.bind(this);
    this.renderOperation = this.renderOperation.bind(this);
    this.handleRoomUpdate = this.handleRoomUpdate.bind(this);
  }

  handleRoomUpdate(index, update) {
    const data = [...this.state.data];
    data[index] = Object.assign(data[index], update);
    this.setState({ data });
  }

  fetchData(state, instance) {
    this.setState({ loading: true });
    restApi.getRooms(state.page, state.pageSize, (err, resp) => {
      if (err) {
        return notify('error', '获取所有房间失败', err);
      }
      let ret = JSON.parse(resp);
      this.pagination = state;
      this.setState({
        data: ret,
        pageSize: state.pageSize,
        pages: Math.ceil(this.roomCount / state.pageSize),
        loading: false
      });
    });
  }

  renderEditable(cellInfo) {
    return e(
      'div',
      {
        style: { backgroundColor: '#fafafa' },
        contentEditable: true,
        suppressContentEditableWarning: true,
        onBlur: e => {
          const data = [...this.state.data];
          const originColumn = data[cellInfo.index][cellInfo.column.id];
          if (typeof originColumn === 'number') {
            data[cellInfo.index][cellInfo.column.id] = parseInt(e.target.innerHTML);
          }
          if (typeof originColumn === 'string') {
            data[cellInfo.index][cellInfo.column.id] = e.target.innerHTML;
          }
          this.setState({ data });
        },
        dangerouslySetInnerHTML: {
          __html: this.state.data[cellInfo.index][cellInfo.column.id]
        }
      }
    );
  }

  renderOperation(cellInfo) {
    const opRoom = this.state.data[cellInfo.index];
    return e(
      'div',
      {style: {textAlign: 'center'}},
      e(
        'button',
        {
          className: 'btn btn-sm btn-primary',
          style: { marginRight: '5px' },
          'data-toggle': 'modal',
          'data-target': '#' + this.modalId,
          onClick: ()=>{
            const domModal = document.querySelector('#' + this.modalId);
            ReactDOM.unmountComponentAtNode(domModal);
            ReactDOM.render(
              e(
                RoomModal,
                {
                  data: opRoom,
                  index: cellInfo.index,
                  onRoomUpdate: this.handleRoomUpdate
                }
              ),
              domModal
            );
          }
        },
        '详情'
      ),
      e(
        'button',
        {
          className: 'btn btn-sm btn-success',
          style: { marginRight: '5px' },
          onClick: ()=>{
            restApi.updateRoom(opRoom._id, opRoom, (err, resp) => {
              if (err) {
                return notify('error', '更新房间', resp);
              }
              notify('info', '更新房间成功', opRoom._id);
              this.fetchData(this.pagination);
            });
          }
        },
        '应用'
      ),
      e(
        'button',
        {
          className: 'btn btn-sm btn-warning',
          onClick: ()=>{
            notifyConfirm('删除', '是否删除房间 ' + opRoom._id, ()=>{
              restApi.deleteRoom(opRoom._id, (err, resp) => {
                if (err) {
                  return notify('error', '删除房间', resp);
                }
                this.roomCount--;
                this.fetchData(this.pagination);
              });
            });
          }
        },
        '删除'
      )
    );
  }

  render() {
    const { data, pages, loading } = this.state;
    const columns = [
      {
        Header: 'ID',
        accessor: '_id'
      },
      {
        Header: '名称',
        accessor: 'name',
        Cell: this.renderEditable
      },
      {
        Header: '最大输入源数',
        accessor: 'inputLimit',
        Cell: this.renderEditable
      },
      {
        Header: '最大参与者数',
        accessor: 'participantLimit',
        Cell: this.renderEditable
      },
      {
        id: 'views.length',
        Header: '视图数',
        accessor: d => d.views ? d.views.length : 0
      },
      {
        Header: e(
          'button',
          {
            className: 'btn btn-sm',
            onClick: (e)=>{
              e.stopPropagation();
              restApi.createRoom({name: '新建房间'}, (err, resp) => {
                if (err) {
                  return notify('error', '添加房间失败', resp);
                }
                let createdRoom = JSON.parse(resp);
                notify('info', '添加房间成功', createdRoom._id);
                this.roomCount++;
                this.fetchData(this.pagination);
              });
            }
          },
          '新建房间'
        ),
        Cell: this.renderOperation
      }
    ];

    const manual = true;
    const onFetchData = this.fetchData;

    return e('div', {},
      e('h1', {className: 'page-header'}, '所有房间'),
      e(
        ReactTable,
        {
          data,
          pages,
          loading,
          columns,
          manual: true,
          sortable: false,
          onFetchData: this.fetchData,
          defaultPageSize: 20
        }
      )
    );
  }
}

const domContainer = document.querySelector('#mainApp');

function renderRoom() {
  ReactDOM.unmountComponentAtNode(domContainer);
  ReactDOM.render(e(RoomApp, {count: roomTotal || 1, modalId: 'mainModal'}), domContainer);
}

function renderService() {
  ReactDOM.unmountComponentAtNode(domContainer);
  ReactDOM.render(e(ServiceApp, {count: roomTotal || 1, modalId: 'mainModal'}), domContainer);
}
