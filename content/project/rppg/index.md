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

Measure your own heart rate with your webcam, right in the browser. Every heartbeat changes the blood flow in the vessels of the face, which slightly changes the intensity of the light reflected by the skin; by capturing these changes with the camera, the demo calculates the heart rate.

<!--more-->

The demo runs the remote photoplethysmography (rPPG) algorithms used in [Prof. Wenjin Wang's lab](https://sites.google.com/site/rppgwenjin) at SUSTech, where I did my undergraduate research: **POS**, **PBV** and **DIS**. For details, see [Algorithmic Principles of Remote PPG](https://doi.org/10.1109/TBME.2016.2609282) (Wang et al., IEEE TBME, 2017).

All processing happens locally in your browser. No video is uploaded or stored.

[**Open the live demo →**](../../rppg/)
