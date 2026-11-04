{ lib, platform }:
let
  trim = lib.trim;
  unquote = value:
    let
      single = builtins.match "'([^']*)'" value;
      double = builtins.match ''"([^"]*)"'' value;
    in
    if single != null then builtins.head single
    else if double != null then builtins.head double
    else value;

  token = value:
    let value' = unquote (trim value);
    in if builtins.match "[A-Za-z0-9_+-]+" value' == null then null else value';

  inlineList = value:
    let
      matched = builtins.match "[[](.*)[]][[:space:]]*(#.*)?" (trim value);
      values = if matched == null then [ ] else map token (lib.splitString "," (builtins.head matched));
    in
    if matched == null || values == [ ] || builtins.elem null values then null else values;

  current = {
    os = if platform.isLinux then "linux" else if platform.isDarwin then "darwin" else null;
    cpu = if platform.parsed.cpu.name == "x86_64" then "x64"
      else if platform.parsed.cpu.name == "aarch64" then "arm64" else null;
    libc = if platform.isLinux && builtins.elem (platform.libc or null) [ "musl" "glibc" ] then platform.libc else null;
  };

  # Recognize pnpm's flow and block sequences. Unrecognized YAML must retain
  # packages rather than silently selecting a smaller set of platforms.
  fromWorkspace = workspaceFile:
    let
      state = builtins.foldl' (state: line:
        let
          start = builtins.match "supportedArchitectures:[[:space:]]*(#.*)?" line;
          section = builtins.match "[^[:space:]#][^:]*:.*" line;
          axis = builtins.match "  (os|cpu|libc):[[:space:]]*(.*)" line;
          item = builtins.match "[[:space:]]+-[[:space:]]+([^#]+)(#.*)?" line;
          blank = builtins.match "[[:space:]]*(#.*)?" line;
        in
        if start != null then { active = true; values = { }; collecting = null; valid = state.valid; }
        else if state.active && section != null then state // { active = false; collecting = null; }
        else if !state.active || blank != null then state
        else if axis != null then
          let name = builtins.elemAt axis 0; value = trim (builtins.elemAt axis 1);
          in if value == "" || lib.hasPrefix "#" value then
            state // { values = state.values // { ${name} = [ ]; }; collecting = name; }
          else state // { values = state.values // { ${name} = inlineList value; }; collecting = null; }
        else if item != null && state.collecting != null then
          let value = token (builtins.elemAt item 0); name = state.collecting;
          in state // { values = state.values // { ${name} = if value == null then null else if state.values.${name} == null then null else state.values.${name} ++ [ value ]; }; }
        else state // { valid = false; }
      ) { active = false; values = { }; collecting = null; valid = true; }
        (lib.splitString "\n" (builtins.readFile workspaceFile));
      resolve = name: values:
        if values == null || values == [ ] || (name == "libc" && current.libc == null) || (builtins.elem "current" values && current.${name} == null) then null
        else map (value: if value == "current" then current.${name} else value) values;
    in
    if !state.valid then { } else lib.mapAttrs resolve state.values;

  compatible = supported: entry:
    lib.all (axis:
      let selected = supported.${axis} or null; required = entry.${axis} or null;
      in selected == null || required == null || builtins.elem "any" required || lib.any (value: builtins.elem value required) selected
    ) [ "os" "cpu" "libc" ];
in
{
  inherit inlineList fromWorkspace compatible;
}
