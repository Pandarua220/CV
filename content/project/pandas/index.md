---
title: Video-based Seizure Detection in NICU
date: 2024-04-26
content:
abstract: Limb movement coordination is a critical indicator in general movement analysis (GMA), which is often used to assess newborn neurological development. Asymmetry in limb movements may indicate brain injury or motor control disorders, also associated with conditions such as cerebral palsy. In this work, we present an automated video processing framework for assessing the coordination of left and right limb movements, aiming to assist healthcare professionals to evaluate infant's limb movement coordination during GMA. We use AggPose, a pose recognition tool based on a Transformer architecture, to extract 12 keypoints (including arms and legs) from video frames. The intensity of movement is calculated using the temporal standard deviation of the keypoint coordinates. Finally, the coordination of movement is analyzed by comparing the cross-correlation and Pearson correlation coefficients of the movement signals between left and right limbs. Our clinical dataset, created in the neonatal intensive care unit, includes 23 preterm infants without neurological disorders. The proposed method shows average cross-correlation and Pearson correlation coefficients of 0.788 and 0.712, respectively, indicating the potential in analyzing the motion coordination of infant limb movements.
tags:
  - Video
  - Seizure
  - NICU
---

Flexible and powerful data analysis / manipulation library for Python, providing labeled data structures.

<!--more-->
