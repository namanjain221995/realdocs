{
  "targets": [
    {
      "target_name": "display_affinity",
      "sources": [],
      "conditions": [
        [
          "OS=='win'",
          {
            "sources": ["src/addon.cc"],
            "defines": [
              "NAPI_VERSION=8",
              "NAPI_DISABLE_CPP_EXCEPTIONS",
              "_WIN32_WINNT=0x0A00",
              "WINVER=0x0A00",
              "WIN32_LEAN_AND_MEAN",
              "NOMINMAX",
              "UNICODE",
              "_UNICODE"
            ],
            "libraries": ["-luser32.lib", "-ldwmapi.lib"],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "ExceptionHandling": 0,
                "AdditionalOptions": ["/guard:cf", "/W4", "/WX"]
              },
              "VCLinkerTool": {
                "AdditionalOptions": ["/guard:cf", "/DYNAMICBASE", "/NXCOMPAT", "/HIGHENTROPYVA"]
              }
            }
          }
        ]
      ]
    }
  ]
}
