---
title: 'Projects'
date: 2024-05-19
type: landing

design:
  # Section spacing
  spacing: '5rem'

# Page sections
sections:
  - block: collection
    content:
      title: Selected Projects
      text: Here are a selection of projects that I have worked on over the past 2 years.    
      filters:
        folders:
          - project
    design:
      view: article-grid
      fill_image: false
      columns: 2
      date_format: 'January 2006'
  - block: markdown
    content:
      title: Research Focus
      text: |
        #### Overview

        Our work bridges computer vision and biomedical engineering to develop non-contact health monitoring technologies, with a primary focus on neonates in the Neonatal Intensive Care Unit (NICU).

        #### Challenge  
        Traditional monitoring techniques, such as electrocardiography (ECG) and electroencephalography (EEG), pose risks of infection and skin damage, making them unsuitable for long-term use in vulnerable infant populations.

        #### Innovation  
        To overcome these limitations, we designed a vision-based system employing remote photoplethysmography (rPPG) to estimate vital signs—including heart rate and blood oxygenation—in a completely contact-free manner.

        #### Current Focus  
        We are expanding this approach to develop an automated sleep staging system for newborns. By integrating multimodal signals such as heart rate, heart rate variability, respiratory rate, and movement patterns captured via camera, the system aims to classify sleep stages autonomously, thereby reducing the operational burden on NICU clinical staff.

---