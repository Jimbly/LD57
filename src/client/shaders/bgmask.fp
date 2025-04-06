#pragma WebGL2

precision lowp float;

uniform sampler2D tex0;
uniform sampler2D tex1;
uniform lowp vec4 color1;
uniform highp vec4 uv1;
uniform highp vec4 uv2;

varying lowp vec4 interp_color;
varying vec2 interp_texcoord;

void main(void) {
  vec4 texA = texture2D(tex0, interp_texcoord * uv1.xy + uv1.zw);
  vec4 texB = texture2D(tex1, interp_texcoord * uv2.xy + uv2.zw);
  // vec2 texB = texture2D(tex1,interp_texcoord).rg;
  // float value = dot(texA.rgb, vec3(0.2, 0.5, 0.3));
  // vec3 valueR = value * interp_color.rgb;
  // vec3 valueG = value * color1.rgb;
  // vec3 value3 = mix(texA.rgb, valueG, texB.g);
  // value3 = mix(value3, valueR, texB.r);
  gl_FragColor = vec4(texA.rgb, texB.r);
}
