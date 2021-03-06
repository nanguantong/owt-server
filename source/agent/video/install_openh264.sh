#!/usr/bin/env bash
# Copyright (C) <2019> Intel Corporation
#
# SPDX-License-Identifier: Apache-2.0

# OpenH264 Library Install Script

this=$(dirname "$0")
this=$(cd "${this}"; pwd)

echo -e "\x1b[32mOpenH264 Video Codec provided by Cisco Systems, Inc.\x1b[0m"

MAJOR=2
MINOR=1
PATCH=1
SOVER=6

RELNAME=libopenh264-${MAJOR}.${MINOR}.${PATCH}-linux64.${SOVER}.so
SONAME=libopenh264.so.${SOVER}

download_openh264(){
  echo "Download OpenH264..."
  wget -c https://github.com/cisco/openh264/releases/download/v${MAJOR}.${MINOR}.${PATCH}/${RELNAME}.bz2 && \
  bzip2 -d ${RELNAME}.bz2 && \
  echo "Download ${RELNAME} success."
}

enable_openh264() {
  [ -f ${this}/lib/dummyopenh264.so ] || mv ${this}/lib/${SONAME} ${this}/lib/dummyopenh264.so
  mv ${RELNAME} ${this}/lib/${SONAME} && \
  echo "OpenH264 install finished."
}

[ ! -f ${this}/lib/dummyopenh264.so ] && download_openh264 && enable_openh264
