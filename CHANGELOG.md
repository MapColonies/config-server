# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [1.2.0](https://github.com/MapColonies/config-server/compare/v1.1.1...v1.2.0) (2024-12-19)


### Features

* added typescript paths ([#67](https://github.com/MapColonies/config-server/issues/67)) ([8e1f267](https://github.com/MapColonies/config-server/commit/8e1f2676acca53e92de04d890307f20adaaf78bf))
* default configs ([#64](https://github.com/MapColonies/config-server/issues/64)) ([701d003](https://github.com/MapColonies/config-server/commit/701d0034108ef67896160746d0b6c923ce217d34))


### Bug Fixes

* changed ref replacement loop not to break on root ref ([#63](https://github.com/MapColonies/config-server/issues/63)) ([a857d5f](https://github.com/MapColonies/config-server/commit/a857d5f59584881aa2f84b03fd7e2b729d360efe))

### [1.1.1](https://github.com/MapColonies/config-server/compare/v1.1.0...v1.1.1) (2024-11-28)

## [1.1.0](https://github.com/MapColonies/config-server/compare/v1.0.1...v1.1.0) (2024-10-30)


### Features

* logs pass ([#57](https://github.com/MapColonies/config-server/issues/57)) ([3d2fc0e](https://github.com/MapColonies/config-server/commit/3d2fc0e56a38c04436981d56a39483552d973919))
* tracing pass ([#58](https://github.com/MapColonies/config-server/issues/58)) ([95134b5](https://github.com/MapColonies/config-server/commit/95134b53eeec9c66f717ca791ee43237b0ad5ba3))

### [1.0.1](https://github.com/MapColonies/config-server/compare/v1.0.0...v1.0.1) (2024-10-27)


### Bug Fixes

* changed schema bundle to dereference ([#51](https://github.com/MapColonies/config-server/issues/51)) ([4be6da0](https://github.com/MapColonies/config-server/commit/4be6da0fa000c40d5c6ab5fc2caf13e97f67a60f))
* express metrics works ([#54](https://github.com/MapColonies/config-server/issues/54)) ([f96e053](https://github.com/MapColonies/config-server/commit/f96e053ec62af1f2ce44b48589022fa5f0a2810c))
* when schema is not found in post config correct http code is returned ([#50](https://github.com/MapColonies/config-server/issues/50)) ([cec662a](https://github.com/MapColonies/config-server/commit/cec662a9f0081178b745415265b46c2b9cf35725))

## 1.0.0 (2024-10-13)


### Features

* added is latest ([#36](https://github.com/MapColonies/config-server/issues/36)) ([29eb92b](https://github.com/MapColonies/config-server/commit/29eb92be674f2ff8d0b51726fd90e95b6d0fa380))
* added pattern validation for config name ([d979f08](https://github.com/MapColonies/config-server/commit/d979f089b128a1174266b93d5c4767f4c170081e))
* added sorting to get configs request ([#40](https://github.com/MapColonies/config-server/issues/40)) ([238b742](https://github.com/MapColonies/config-server/commit/238b7427b0d06bf18e7ff01785601774d2624e6a))
* capabilities endpoint ([#2](https://github.com/MapColonies/config-server/issues/2)) ([5f553ce](https://github.com/MapColonies/config-server/commit/5f553cef84b04257d9981a78bea27bbfdc530754))
* config endpoints ([#3](https://github.com/MapColonies/config-server/issues/3)) ([31de474](https://github.com/MapColonies/config-server/commit/31de47456d1b08ce18c27c9aac15d01977603de5))
* config refs ([#16](https://github.com/MapColonies/config-server/issues/16)) ([78c392d](https://github.com/MapColonies/config-server/commit/78c392d5d4fbad2564cb481f3bb82f24c4f6cd68))
* implemented schema endpoints ([#1](https://github.com/MapColonies/config-server/issues/1)) ([02ccad7](https://github.com/MapColonies/config-server/commit/02ccad79a866e50439204a9667f1911febe47cc2))
* server is now deployable ([#48](https://github.com/MapColonies/config-server/issues/48)) ([5b97014](https://github.com/MapColonies/config-server/commit/5b97014a243511cdf48ed384cb9baf9aa3ad67f9))
* upgraded json schema version to 2019-09 ([#45](https://github.com/MapColonies/config-server/issues/45)) ([684e7d4](https://github.com/MapColonies/config-server/commit/684e7d4de36c7fa5dfb01db2d2f10ae79abdfdf4))


### Bug Fixes

* changed configname pattern so sequential dashes are prohibited ([1f4bdcf](https://github.com/MapColonies/config-server/commit/1f4bdcfa5c360c63fafe3e16683450f8577dbbc6))
* fixed incorrect id in schematree request ([#25](https://github.com/MapColonies/config-server/issues/25)) ([8dd35cc](https://github.com/MapColonies/config-server/commit/8dd35cc5cd2a151a70d9ad130c249a26c51e7770))
* query was incorrect ([#31](https://github.com/MapColonies/config-server/issues/31)) ([e11ad9d](https://github.com/MapColonies/config-server/commit/e11ad9d18639f58e8d2421887094ffb33212102d))
* separated the schema cache between dereferenced and non dereferenced schemas ([#27](https://github.com/MapColonies/config-server/issues/27)) ([5523da3](https://github.com/MapColonies/config-server/commit/5523da3f002d497341cd19a7f50b6a98ea1fff2c))
* support ref in object root and not return 500 ([#41](https://github.com/MapColonies/config-server/issues/41)) ([93318f2](https://github.com/MapColonies/config-server/commit/93318f24984a53afa24e5a1ce7f1e32e4ea1b070))
* when schema of previous version is different error is thrown ([#33](https://github.com/MapColonies/config-server/issues/33)) ([8a76558](https://github.com/MapColonies/config-server/commit/8a765581cb946d5f9f9db08fba6ceb70c3437d30))
