ffmpeg \
  -v \
  error \
  -map \
  [base] \
  -vframes \
  1 \
  -filter_complex \
  color=s=1920x1080:color=black:duration=6[base] \
  'test/resources/empty_preview/preview.jpg' \
  -y