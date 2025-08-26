---
title: 'Volunteer & Leadership'
date: 2024-05-19
type: landing

design:
  # Section spacing
  spacing: '5rem'

# Page sections
sections:
  - block: resume-experience
    content:
      username: admin
    design:
      # Hugo date format
      date_format: 'January 2006'
      # Education or Experience section first?
      is_education_first: false

  - block: collection
    content:
      title: Volunteer Projects
      text: Some of the volunteer projects that I have worked on.
      filters:
        folders:
          - volunteer

    design:
      view: article-grid
      fill_image: false
      columns: 3
---
