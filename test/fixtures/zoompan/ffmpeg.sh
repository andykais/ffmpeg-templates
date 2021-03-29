ffmpeg \
  -v \
  error \
  -ss \
  0 \
  -t \
  14.698667 \
  -i \
  '/home/andrew/Code/development/ffmpeg-templates/test/resources/assets/Pexels Videos 2048452.mp4' \
  -ss \
  0 \
  -t \
  14.698667 \
  -i \
  '/home/andrew/Code/development/ffmpeg-templates/test/resources/assets/Video Of People Waiting For A Taxi On A Rainy Night.mp4' \
  -map \
  [v_out_1] \
  -filter_complex \
  'color=s=960x2160:color=black:duration=14.698667[base];
[0:v] setpts=PTS-STARTPTS, scale=1920:1080, crop=w=960:h=1080:x='if(gte(t, 10), 0, if(between(t, 0, 10), (n - 0)*-3.2032000000000003+960, if(between(t, 0, 0), (n - 0)*Infinity+0, 0)))':y=0:keep_aspect=1 [v_in_0];
[0:a] asetpts=PTS-STARTPTS, adelay=0:all=1, volume=1[a_in_0];
[1:v] setpts=PTS-STARTPTS, scale=1921:1080, crop=w=960.5:h=1080:x='if(gte(t, 10), 960.5, if(between(t, 0, 10), (n - 0)*3.842+0, 960.5))':y=0:keep_aspect=1 [v_in_1];
[1:a] asetpts=PTS-STARTPTS, adelay=0:all=1, volume=1[a_in_1];
[base][v_in_0] overlay=x=0:y=0:eof_action=pass [v_out_0];
[v_out_0][v_in_1] overlay=x=0:y=1080:eof_action=pass [v_out_1];
[a_in_0][a_in_1] amix=inputs=2 [audio]' \
  -map \
  [audio] \
  'test/resources/zoompan/output.mp4' \
  -y