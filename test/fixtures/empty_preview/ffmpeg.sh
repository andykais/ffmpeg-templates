ffmpeg \
  -v \
  error \
  -vframes \
  1 \
  -filter_complex \
  color=s=1920x1080:color=black:duration=6[base] \
  -map \
  [base] \
  "test/resources/ffmpeg-templates-projects/test/resources/empty_preview/preview.jpg" \
  -y