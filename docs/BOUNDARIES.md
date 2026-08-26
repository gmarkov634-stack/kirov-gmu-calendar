# Ownership boundaries

`kirov-gmu-calendar` владеет только КГМУ-специфичным контуром.

Разрешено здесь:
- source configuration;
- faculty/group catalog;
- parser rules;
- mappings;
- fixtures;
- university QA rules;
- landing;
- VK configuration.

Запрещено дублировать здесь shared core:
- customers/commerce/trial;
- entitlements/subscriptions/token lifecycle;
- CalendarPreferences/postprocessing;
- shared parsing/publication schemas;
- Calendar/ICS API.

Фактические URL официальных источников, структура факультетов и групп добавляются только после проверки официального источника КГМУ. Production secrets в Git не записываются.
