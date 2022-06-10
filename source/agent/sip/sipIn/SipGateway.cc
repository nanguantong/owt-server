// Copyright (C) <2019> Intel Corporation
//
// SPDX-License-Identifier: Apache-2.0

#ifndef BUILDING_NODE_EXTENSION
#define BUILDING_NODE_EXTENSION
#endif

#include "SipGateway.h"
#include "../../addons/common/NodeEventRegistry.h"
#include <nan.h>

using namespace v8;

static std::string getString(v8::Local<v8::Value> value) {
  Nan::Utf8String value_str(Nan::To<v8::String>(value).ToLocalChecked());
  return std::string(*value_str);
}

Persistent<Function> SipGateway::constructor;
SipGateway::SipGateway() {}
SipGateway::~SipGateway() {}

void SipGateway::Init(Local<Object> exports) {
  // Prepare constructor template
  Isolate* isolate = Isolate::GetCurrent();
  Local<FunctionTemplate> tpl = FunctionTemplate::New(isolate, New);
  tpl->SetClassName(Nan::New("SipGateway").ToLocalChecked());
  tpl->InstanceTemplate()->SetInternalFieldCount(1);
  // Prototype
  SETUP_EVENTED_PROTOTYPE_METHODS(tpl);
  NODE_SET_PROTOTYPE_METHOD(tpl, "close", close);
  NODE_SET_PROTOTYPE_METHOD(tpl, "register", sipReg);
  NODE_SET_PROTOTYPE_METHOD(tpl, "makeCall", makeCall);
  NODE_SET_PROTOTYPE_METHOD(tpl, "hangup", hangup);
  NODE_SET_PROTOTYPE_METHOD(tpl, "accept", accept);
  NODE_SET_PROTOTYPE_METHOD(tpl, "reject", reject);
  constructor.Reset(isolate, Nan::GetFunction(tpl).ToLocalChecked());
  Nan::Set(exports, Nan::New("SipGateway").ToLocalChecked(),
           Nan::GetFunction(tpl).ToLocalChecked());
}

void SipGateway::New(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  bool preferIpv6 = false;
  uint32_t rtpPortMin = 0, rtpPortMax = 0, rtpTimeout = 0;
  std::string mnat;
  if (args.Length() > 0 && args[0]->IsObject()) {
    Local<String> keyPreferIpv6 = Nan::New("prefer_ipv6").ToLocalChecked();
    Local<String> keyRtpPortMin = Nan::New("minport").ToLocalChecked(); // rtp_port_min
    Local<String> keyRtpPortMax = Nan::New("maxport").ToLocalChecked(); // rtp_port_max
    Local<String> keyRtpTimeout = Nan::New("rtp_timeout").ToLocalChecked();
    Local<String> keyMnat = Nan::New("mnat").ToLocalChecked();

    Local<Object> options = Nan::To<v8::Object>(args[0]).ToLocalChecked();
    if (Nan::Has(options, keyPreferIpv6).FromMaybe(false))
      preferIpv6 = Nan::To<bool>(Nan::Get(options, keyPreferIpv6).ToLocalChecked()).FromJust();
    if (Nan::Has(options, keyRtpPortMin).FromMaybe(false))
      rtpPortMin = Nan::To<uint32_t>(Nan::Get(options, keyRtpPortMin).ToLocalChecked()).FromJust();
    if (Nan::Has(options, keyRtpPortMax).FromMaybe(false))
      rtpPortMax = Nan::To<uint32_t>(Nan::Get(options, keyRtpPortMax).ToLocalChecked()).FromJust();
    if (Nan::Has(options, keyRtpTimeout).FromMaybe(false))
      rtpTimeout = Nan::To<uint32_t>(Nan::Get(options, keyRtpTimeout).ToLocalChecked()).FromJust();
    if (Nan::Has(options, keyMnat).FromMaybe(false))
      mnat = getString(Nan::Get(options, keyMnat).ToLocalChecked());
  }

  SipGateway* obj = new SipGateway();
  obj->me = new sip_gateway::SipGateway();
  obj->me->init(preferIpv6, rtpPortMin, rtpPortMax, rtpTimeout, mnat);

  obj->me->setEventRegistry(obj);
  obj->Wrap(args.This());
  args.GetReturnValue().Set(args.This());
}

void SipGateway::close(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  SipGateway* obj = ObjectWrap::Unwrap<SipGateway>(args.Holder());
  sip_gateway::SipGateway* me = obj->me;

  delete me;
}

void SipGateway::makeCall(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  if (args.Length() < 3 || !args[0]->IsString() || !args[1]->IsBoolean() ||
      !args[2]->IsBoolean()) {
    Nan::ThrowError("Wrong arguments");
    return;
  }
  SipGateway* obj = ObjectWrap::Unwrap<SipGateway>(args.Holder());
  sip_gateway::SipGateway* me = obj->me;

  Nan::Utf8String param0(Nan::To<v8::String>(args[0]).ToLocalChecked());
  std::string calleeURI = std::string(*param0);
  bool requireAudio = Nan::To<bool>(args[1]).FromJust();
  bool requireVideo = Nan::To<bool>(args[2]).FromJust();
  bool isSuccess = me->makeCall(calleeURI, requireAudio, requireVideo);
  args.GetReturnValue().Set(Boolean::New(isolate,isSuccess));
}

void SipGateway::hangup(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  Nan::Utf8String param0(Nan::To<v8::String>(args[0]).ToLocalChecked());
  std::string calleeURI = std::string(*param0);

  SipGateway* obj = ObjectWrap::Unwrap<SipGateway>(args.Holder());
  sip_gateway::SipGateway* me = obj->me;
  me->hangup(calleeURI);
}

void SipGateway::accept(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  Nan::Utf8String param0(Nan::To<v8::String>(args[0]).ToLocalChecked());
  std::string calleeURI = std::string(*param0);

  SipGateway* obj = ObjectWrap::Unwrap<SipGateway>(args.Holder());
  sip_gateway::SipGateway* me = obj->me;
  bool isSuccess = me->accept(calleeURI);
  args.GetReturnValue().Set(Boolean::New(isolate, isSuccess));
}

void SipGateway::reject(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  Nan::Utf8String param0(Nan::To<v8::String>(args[0]).ToLocalChecked());
  std::string calleeURI = std::string(*param0);

  SipGateway* obj = ObjectWrap::Unwrap<SipGateway>(args.Holder());
  sip_gateway::SipGateway* me = obj->me;
  me->reject(calleeURI);
}

void SipGateway::sipReg(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = Isolate::GetCurrent();
  HandleScope scope(isolate);

  if (args.Length() < 5 || !args[0]->IsString() || !args[1]->IsString() ||
      !args[2]->IsString() || !args[3]->IsString() || !args[4]->IsString()) {
    Nan::ThrowError("Wrong arguments");
    return;
  }
  SipGateway* obj = ObjectWrap::Unwrap<SipGateway>(args.Holder());
  sip_gateway::SipGateway* me = obj->me;
  Nan::Utf8String str0(Nan::To<v8::String>(args[0]).ToLocalChecked());
  Nan::Utf8String str1(Nan::To<v8::String>(args[1]).ToLocalChecked());
  Nan::Utf8String str2(Nan::To<v8::String>(args[2]).ToLocalChecked());
  Nan::Utf8String str3(Nan::To<v8::String>(args[3]).ToLocalChecked());
  Nan::Utf8String str4(Nan::To<v8::String>(args[4]).ToLocalChecked());
  std::string sipServerAddr = std::string(*str0);
  std::string userName = std::string(*str1);
  std::string password = std::string(*str2);
  std::string displayName = std::string(*str3);
  std::string transport = std::string(*str4);
  bool isSuccess = me->sipRegister(sipServerAddr, userName, password, displayName, transport);
  args.GetReturnValue().Set(Boolean::New(isolate, isSuccess));
}
