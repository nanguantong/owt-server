// Copyright (C) <2019> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

'use strict';

var restApi;
var mode = "";
var metadata;
var ENUMERATE = {
  SERVICE: "service",
  ROOM: "room",
  RUNTIME: "runtime"
};
var serviceId = "";
var serviceKey = "";

var roomTotal = 1;

function checkProfile(callback) {
  restApi = ManagementApi.init();
  restApi.loginCheck(function(err, text) {
    if (err === 401) {
      $('#myModal').modal('show');
      return;
    } else if (err) {
      notify('error', '获取服务信息失败', err);
      return;
    } else {
      var myService = JSON.parse(text);
      roomTotal = myService.rooms.length;
      serviceId = myService._id;
      document.getElementById("inputId").value = serviceId;
      judgePermissions();
      callback();
    }
  });
}

$('button#clearCookie').click(function() {
  document.cookie = 'serviceId=; expires=Thu, 01 Jan 1970 00:00:00 UTC';
  document.cookie = 'serviceKey=; expires=Thu, 01 Jan 1970 00:00:00 UTC';
  restApi = ManagementApi.init();
  restApi.logout(function(err) {
    if (err) {
      notify('error', '退出失败', err);
      return;
    }
  });
  document.getElementById("inputId").value = "";
  document.getElementById("inputKey").value = "";
});

$('button#saveServiceInfo').click(function() {
  serviceId = $('.modal-body #inputId').val();
  serviceKey = $('.modal-body #inputKey').val();
  var rememberMe = $('.modal-body .checkbox input').prop('checked');
  if (serviceId !== '' && serviceKey !== '') {
    if (rememberMe) {
      setCookie('serviceId', serviceId, 365);
      setCookie('serviceKey', serviceKey, 365);
    }
    restApi = ManagementApi.init();
    restApi.login(serviceId, serviceKey, function(err) {
      if (err) {
        notify('error', '登录失败', err);
        return;
      }
      document.getElementById("inputKey").value = "";
      judgePermissions();
    });
    if (restApi) {
      $("#myModal").modal("hide");
      renderRoom();
    }
  }
});

function judgePermissions(flag) {
  restApi.getServices(function(err, text) {
    if (!err) {
      $(".li").removeClass("hideLi");
    } else {
      $(".li:not(.normal)").addClass("hideLi").removeClass("active");
      $(".li.normal").addClass("active");
      $(".overview").hide();
      $(".room").show();
      $(".runtime").hide();
      $(".page-header").text("所有房间");
      mode = ENUMERATE.ROOM;
    }
  });
}

function a_click(nowList, dom) {
  var service = $(".overview");
  var room = $(".room");
  var runtime = $(".runtime");
  var nowLI = $(dom.parentNode);
  var title = $(".page-header");
  if (nowLI.hasClass("active")) {
    return;
  } else {
    $(".li").removeClass("active");
    nowLI.addClass("active");
  }
  switch (nowList) {
    case ENUMERATE.SERVICE:
      title.text("所有服务");
      checkProfile(renderService);
      break;
    case ENUMERATE.ROOM:
      title.text("所有房间");
      checkProfile(renderRoom);
      break;
    case ENUMERATE.RUNTIME:
      title.text("MCU 运行");
      checkProfile(renderCluster);
      break;
  }
}

var login = new Promise((resolve, reject) => {
  $(".close").on("click", function() {
    if (serviceId === '' || serviceKey === '') {
      return;
    } else {
      $("#myModal").modal("hide");
    }
  });
  checkProfile(()=>resolve());
});

login.then(()=> {
  renderRoom();
});
