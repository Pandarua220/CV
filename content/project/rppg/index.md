---
title: 'Live Demo: Camera-based Heart Rate (rPPG)'
date: 2026-10-31
tags:
  - rPPG
  - Computer Vision
  - Demo
links:
  - name: Try the live demo
    url: rppg/
---

Measure your own heart rate with your webcam, right in the browser. The demo runs the remote photoplethysmography (rPPG) algorithms my undergraduate lab used for contactless monitoring of neonates in the NICU: **POS** (Plane-Orthogonal-to-Skin), **PBV** (blood volume pulse signature) and **DIS** (discriminative signatures with head-motion channels).

<!--more-->

The pipeline is a JavaScript port of our MATLAB code. It splits the face into 28 skin patches, applies sliding-window DC normalisation and 0.7–3 Hz band-pass filtering, extracts the pulse with POS, PBV or DIS, keeps the 5 patches with the best SNR, overlap-adds the windows, and reads the heart rate off a 10-second spectrum.

Because the pulse signature used by PBV and DIS depends on the camera and the lighting, the demo calibrates it live for each visitor's camera, using the POS pulse as the reference.

All processing happens locally in your browser. No video is uploaded or stored.

[**Open the live demo →**](../../rppg/)
