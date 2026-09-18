cmake_minimum_required(VERSION 3.13)
project(pubsuffix-wla VERSION 1.0.0 LANGUAGES C)

include(GNUInstallDirs)

find_program(NPM_EXECUTABLE npm REQUIRED)
mark_as_advanced(NPM_EXECUTABLE)

if (WIN32)
  set(NPM_PREFIX "cmd" "/c")
endif ()

find_package(LibNetQ REQUIRED)
find_package(LibPSL REQUIRED)

option(PUBSUFFIX_INSTALL_SERVER "Install the pubsuffix server" ON)
option(PUBSUFFIX_INSTALL_MODULE "Install the pubsuffix module" ON)
option(PUBSUFFIX_INSTALL_ASSETS "Install pubsuffix supporting assets" ON)

set(PUBSUFFIX_BASE_URL "/" CACHE STRING "URL path prefix the pubsuffix module is served under (a trailing slash is appended if missing)")
set(PUBSUFFIX_ROOT_URL "${PUBSUFFIX_BASE_URL}")
if (NOT PUBSUFFIX_ROOT_URL MATCHES "/$")
  set(PUBSUFFIX_ROOT_URL "${PUBSUFFIX_ROOT_URL}/")
endif ()

set(PUBSUFFIX_START_URL "" CACHE STRING "URL a fresh request draft starts with; empty uses the page's own origin")
set(PUBSUFFIX_PSL_URL "${PUBSUFFIX_ROOT_URL}psl")
set(PUBSUFFIX_ASSETS_DIR "${CMAKE_INSTALL_DATADIR}/${PROJECT_NAME}")

set(PUBSUFFIX_DATAFILES
  config.h.in
  )

file(GLOB_RECURSE PUBSUFFIX_TSXFILES
  "src/*.ts"
  "src/*.tsx"
  )

set(PUBSUFFIX_DISTFILES
  dist/index.html
  dist/manifest.json
  )

add_custom_command(
  COMMAND ${NPM_PREFIX} "${NPM_EXECUTABLE}" install
  COMMAND ${NPM_PREFIX} "${NPM_EXECUTABLE}" run build --base-url=${PUBSUFFIX_BASE_URL} --start-url=${PUBSUFFIX_START_URL}
  DEPENDS package.json ${PUBSUFFIX_TSXFILES}
  OUTPUT ${PUBSUFFIX_DISTFILES}
  WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
  )

configure_file(config.h.in "${CMAKE_CURRENT_BINARY_DIR}/config.h" @ONLY)

source_group(TREE "${CMAKE_CURRENT_SOURCE_DIR}" FILES module.c ${PUBSUFFIX_DATAFILES} ${PUBSUFFIX_DISTFILES})
add_library(pubsuffix_wla SHARED module.c ${PUBSUFFIX_DATAFILES} ${PUBSUFFIX_DISTFILES})
target_include_directories(pubsuffix_wla PRIVATE "$<BUILD_INTERFACE:${CMAKE_CURRENT_BINARY_DIR}>")
target_link_libraries(pubsuffix_wla PUBLIC LibNetQ::LibNetQ LibPSL::LibPSL)
set_property(TARGET pubsuffix_wla PROPERTY POSITION_INDEPENDENT_CODE ON)
set_target_properties(pubsuffix_wla PROPERTIES PREFIX "" IMPORT_PREFIX "")

source_group(TREE "${CMAKE_CURRENT_SOURCE_DIR}" FILES server.c)
add_executable(pubsuffix_server server.c)
target_link_libraries(pubsuffix_server PRIVATE LibNetQ::LibNetQ)

if (APPLE)
  set_target_properties(pubsuffix_server PROPERTIES INSTALL_RPATH "@loader_path/../lib")
elseif (UNIX)
  set_target_properties(pubsuffix_server PROPERTIES INSTALL_RPATH "$ORIGIN/../lib")
  target_link_options(pubsuffix_server PRIVATE -Wl,--disable-new-dtags)
endif ()

if (PUBSUFFIX_INSTALL_SERVER)
  install(TARGETS pubsuffix_server
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
    ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
    )
endif ()

if (PUBSUFFIX_INSTALL_MODULE)
  install(TARGETS pubsuffix_wla
    LIBRARY DESTINATION ${CMAKE_INSTALL_BINDIR}
    ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
    )
endif ()

if (PUBSUFFIX_INSTALL_ASSETS)
  install(DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}/dist/"
    DESTINATION "${PUBSUFFIX_ASSETS_DIR}"
    )
endif ()
