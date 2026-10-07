import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Calculator,
  Layers,
  Zap,
  Clock,
  ShieldCheck,
  FileCheck,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { PublicNavbar } from '../../components/layout/PublicNavbar.tsx';
import { Footer } from '../../components/layout/Footer.tsx';
import { Button } from '../../components/common/Button.tsx';
import { useAuth } from '../../context/AuthContext.tsx';

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const { enableDemoSession } = useAuth();

  const handleOpenDemo = async () => {
    await enableDemoSession();
    navigate('/app/dashboard');
  };

  return (
    <div className="min-h-screen flex flex-col bg-neutral-50 dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100">
      <PublicNavbar />

      <main className="flex-1">
        {/* Compact, technical hero section without giant fluff */}
        <section className="py-16 sm:py-20 px-4 sm:px-6 lg:px-8 border-b border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50">
          <div className="max-w-4xl mx-auto text-center space-y-6">
            <div className="inline-flex items-center gap-2 text-xs font-medium text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1 rounded border border-emerald-200 dark:border-emerald-800/80">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-400" />
              <span>Професійний розрахунок собівартості FDM/FFF 3D-друку</span>
            </div>

            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-neutral-900 dark:text-white max-w-3xl mx-auto" style={{ textWrap: 'balance' }}>
              Точна собівартість та продажний прайс за файлами Bambu Studio
            </h1>

            <p className="text-base sm:text-lg text-neutral-600 dark:text-neutral-300 max-w-2xl mx-auto leading-relaxed">
              Особистий кабінет майстерні для миттєвого вилучення грамів, часу та філаментів із проєктів <code className="text-xs font-mono font-bold bg-neutral-100 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-emerald-700 dark:text-emerald-300">.gcode.3mf</code> з урахуванням електроенергії, амортизації принтера та націнки.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
              <Button
                variant="primary"
                size="lg"
                leftIcon={<Sparkles className="w-4 h-4" />}
                onClick={handleOpenDemo}
              >
                Переглянути демонстраційний кабінет
              </Button>
              <Button
                variant="outline"
                size="lg"
                rightIcon={<ArrowRight className="w-4 h-4" />}
                onClick={() => navigate('/auth/register')}
              >
                Створити акаунт майстерні
              </Button>
            </div>

            <div className="pt-4 flex items-center justify-center gap-6 text-xs text-neutral-500 dark:text-neutral-400">
              <span>✓ Детермінований аналіз метаданих</span>
              <span aria-hidden="true">·</span>
              <span>✓ Безпечний парсинг у браузері</span>
              <span aria-hidden="true">·</span>
              <span>✓ Розрахунок у гривні (UAH)</span>
            </div>
          </div>
        </section>

        {/* Feature Demonstration Blocks */}
        <section id="features" className="py-16 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto space-y-12">
          <div className="text-center space-y-2 max-w-2xl mx-auto">
            <h2 className="text-2xl font-bold text-neutral-900 dark:text-white">
              Архітектура розрахунку собівартості
            </h2>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              Повний контроль кожної гривні витрат — від сопла до пакування клієнту.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white dark:bg-neutral-900 p-6 rounded-xl border border-neutral-200 dark:border-neutral-800 space-y-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <Layers className="w-5 h-5" />
              </div>
              <h3 className="text-base font-semibold text-neutral-900 dark:text-white">
                Матеріали та котушки
              </h3>
              <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
                Розпізнавання типу пластику з файлу Bambu Studio та гнучке зіставлення з вашим складом. Підтримка PLA, PETG, ABS, ASA, TPU, Nylon та композитів CF/GF.
              </p>
            </div>

            <div className="bg-white dark:bg-neutral-900 p-6 rounded-xl border border-neutral-200 dark:border-neutral-800 space-y-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <Zap className="w-5 h-5" />
              </div>
              <h3 className="text-base font-semibold text-neutral-900 dark:text-white">
                Енергія та машинна година
              </h3>
              <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
                Окремий облік витрат на електроенергію за вашим тарифом (кВт·год) та машинної ставки принтера (знос механіки, ременів, сопел та амортизація).
              </p>
            </div>

            <div className="bg-white dark:bg-neutral-900 p-6 rounded-xl border border-neutral-200 dark:border-neutral-800 space-y-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <h3 className="text-base font-semibold text-neutral-900 dark:text-white">
                Ціноутворення та маржа
              </h3>
              <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
                Два режими розрахунку: націнка на собівартість (%) або цільова маржа від ціни продажу. Резерв на технічний брак, мінімальне замовлення та комерційна пропозиція.
              </p>
            </div>
          </div>
        </section>

        {/* Section about Bambu 3MF file format */}
        <section id="bambu-format" className="py-12 bg-neutral-100/60 dark:bg-neutral-900/40 border-y border-neutral-200 dark:border-neutral-800 px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center gap-8">
            <div className="p-4 bg-white dark:bg-neutral-900 rounded-xl border border-neutral-200 dark:border-neutral-800 font-mono text-xs text-neutral-700 dark:text-neutral-300 space-y-2 shrink-0 w-full md:w-80 shadow-2xs">
              <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 pb-2">
                <span className="font-semibold text-neutral-900 dark:text-white">bracket_mount_v2.gcode.3mf</span>
                <span className="text-[10px] text-emerald-600">VALID</span>
              </div>
              <div className="space-y-1 text-[11px] tabular-nums">
                <p>Пластина 1: 7200 сек (2 год 00 хв)</p>
                <p>Трей #1: PETG Black — 100 г</p>
                <p>Трей #2: PLA White — 50 г</p>
                <p>Потужність: 100 Вт (0.200 кВт·год)</p>
                <p className="text-emerald-600 font-bold pt-1 border-t border-neutral-100 dark:border-neutral-800">
                  Собівартість: 149.60 грн → 300.00 грн
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-xl font-bold text-neutral-900 dark:text-white">
                Як працює аналіз .gcode.3mf
              </h3>
              <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
                Файл проєкту Bambu Studio містить зрізану геометрію та точні метадані слайсера: тривалість друку кожної пластини, кількість використаного філаменту за лотками AMS, кольори та тип матеріалу.
              </p>
              <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
                Ваша 3D-модель не завантажується на сторонні сервери — до кабінету зберігається лише числовий паспорт замовлення.
              </p>
            </div>
          </div>
        </section>

        {/* Call to action */}
        <section className="py-16 text-center px-4 max-w-3xl mx-auto space-y-4">
          <h2 className="text-2xl font-bold text-neutral-900 dark:text-white">
            Готові випробувати калькулятор?
          </h2>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Відкрийте демо-кабінет з попередньо налаштованими матеріалами та узгодженим прикладом.
          </p>
          <div className="pt-2">
            <Button variant="primary" size="lg" onClick={handleOpenDemo}>
              Перейти в демо-кабінет PrintCost
            </Button>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
};
