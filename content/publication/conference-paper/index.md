---
title: 'Camera-based Analysis of Motion Coordination Between Infant Left and Right Limbs: A Clinical Study in NICU.'

# Authors
# If you created a profile for a user (e.g. the default `admin` user), write the username (folder name) here
# and it will be replaced with their full name and linked to their profile.
authors:
  - Yiming Zhong
  - Ziyan Wu
  - Yongshen Zeng
  - Xiaoyan Song
  - Qiqiong Wang
  - Wenjin Wang

# Author notes (optional)
author_notes:
  - 'BME, SUSTech'
  - 'BME, SUSTech'
  - 'BME, SUSTech'
  - 'Neonatal Intensive Care Unit, Nanfang Hospital of Southern Medical University, China.'
  - 'Neonatal Intensive Care Unit, Nanfang Hospital of Southern Medical University, China.'
  - 'Corresponding Author, BME, SUSTech' 

date: '2025-07-17'
doi: ''

# Schedule page publish date (NOT publication's date).
publishDate: '2017-01-01T00:00:00Z'

# Publication type.
# Accepts a single type but formatted as a YAML list (for Hugo requirements).
# Enter a publication type from the CSL standard.
publication_types: ['paper-conference']

# Publication name and optional abbreviated publication name.
publication: 47th Annual International Conference of the IEEE Engineering in Medicine and Biology Society (EMBC), 2025.
publication_short: IEEE-EMBC 2025

abstract: Limb movement coordination is a critical indicator in general movement analysis (GMA), which is often used to assess newborn neurological development. Asymmetry in limb movements may indicate brain injury or motor control disorders, also associated with conditions such as cerebral palsy. In this work, we present an automated video processing framework for assessing the coordination of left and right limb movements, aiming to assist healthcare professionals to evaluate infant's limb movement coordination during GMA. We use AggPose, a pose recognition tool based on a Transformer architecture, to extract 12 keypoints (including arms and legs) from video frames. The intensity of movement is calculated using the temporal standard deviation of the keypoint coordinates. Finally, the coordination of movement is analyzed by comparing the cross-correlation and Pearson correlation coefficients of the movement signals between left and right limbs. Our clinical dataset, created in the neonatal intensive care unit, includes 23 preterm infants without neurological disorders. The proposed method shows average cross-correlation and Pearson correlation coefficients of 0.788 and 0.712, respectively, indicating the potential in analyzing the motion coordination of infant limb movements.

# Summary. An optional shortened abstract.
summary: Infant limb motion coordination analysis

tags:
  - EMBC 2025
  - Computer Vision
  - NICU

# Display this page in the Featured widget?
featured: true

# Custom links (uncomment lines below)
# links:
# - name: Custom Link
#   url: http://example.org

url_pdf: 'Camera_based_Analysis_of_Motion_Coordination_between_Infant_Left_and_Right_Limbs_A_Clinical_Study_in_NICU.pdf'
# url_code: 'https://github.com/HugoBlox/hugo-blox-builder'
# url_dataset: 'https://github.com/HugoBlox/hugo-blox-builder'
# url_poster: ''
# url_project: ''
# url_slides: ''
# url_source: 'https://github.com/HugoBlox/hugo-blox-builder'
# url_video: 'https://youtube.com'

# Featured image
# To use, add an image named `featured.jpg/png` to your page's folder.
image:
  caption: ''
  focal_point: ''
  preview_only: False

# Associated Projects (optional).
#   Associate this publication with one or more of your projects.
#   Simply enter your project's folder or file name without extension.
#   E.g. `internal-project` references `content/project/internal-project/index.md`.
#   Otherwise, set `projects: []`.
projects:
  - seizure

# Slides (optional).
#   Associate this publication with Markdown slides.
#   Simply enter your slide deck's filename without extension.
#   E.g. `slides: "example"` references `content/slides/example/index.md`.
#   Otherwise, set `slides: ""`.
slides: example
---
