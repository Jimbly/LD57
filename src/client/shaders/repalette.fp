#pragma WebGL2

precision lowp float;

varying vec2 interp_texcoord;
uniform vec2 param;

uniform sampler2D inputTexture0;
void main()
{
  vec3 tex = texture2D(inputTexture0, interp_texcoord).rgb;
  float v = floor(tex.g * 3.1); // 0...3
  vec3 repal = mix(mix(mix(tex,
    vec3(0.322,0.380,0.314), v),
    vec3(0.655,0.753,0.612), max(0.0, v-1.0)),
    vec3(0.941,0.898,0.631), max(0.0, v-2.0));

  gl_FragColor = vec4(mix(tex, repal, param.x), 1.0);
}
