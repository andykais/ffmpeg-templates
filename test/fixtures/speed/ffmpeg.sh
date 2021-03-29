ffmpeg \
  -v \
  error \
  -ss \
  0 \
  -t \
  7.4986665 \
  -i \
  '/home/andrew/Code/development/ffmpeg-templates/test/resources/assets/Pexels Videos 2048452.mp4' \
  -ss \
  0 \
  -t \
  14.997333 \
  -i \
  '/home/andrew/Code/development/ffmpeg-templates/test/resources/assets/Video Of People Waiting For A Taxi On A Rainy Night.mp4' \
  -map \
  [v_out_1] \
  -filter_complex \
  'color=s=1920x1080:color=black:duration=7.4986665[base];
[0:v] setpts=PTS-STARTPTS, scale=1920:1080, crop=w=960:h=1080:x='0':y=0:keep_aspect=1 [v_in_0];
[0:a] asetpts=PTS-STARTPTS, adelay=0:all=1, volume=1[a_in_0];
[1:v] setpts=0.5*PTS-STARTPTS, scale=1921:1080, crop=w=960.5:h=1080:x='960.5':y=0:keep_aspect=1 [v_in_1];
[1:a] asetpts=PTS-STARTPTS, adelay=0:all=1, volume=1, atempo=1.9999999999999998[a_in_1];
[base][v_in_0] overlay=x=960:y=0:eof_action=pass [v_out_0];
[v_out_0][v_in_1] overlay=x=0:y=0:eof_action=pass [v_out_1];
[a_in_0][a_in_1] amix=inputs=2 [audio]' \
  -map \
  [audio] \
  'test/resources/speed/output.mp4' \
  -y